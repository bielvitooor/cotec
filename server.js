import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CotecError, CotecSession } from './src/cotec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3000);
const TTL_SESSAO = 8 * 60 * 60 * 1000; // 8 horas sem uso encerram a sessão local.

const app = express();
const sessoes = new Map();
const filas = new Map();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

class HttpError extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

function emFila(chave, tarefa) {
  const anterior = filas.get(chave) || Promise.resolve();
  const atual = anterior.then(tarefa, tarefa);
  filas.set(
    chave,
    atual.catch(() => {}),
  );
  return atual;
}

function limparSessoes() {
  const agora = Date.now();
  for (const [token, registro] of sessoes) {
    if (agora - registro.vistoEm > TTL_SESSAO) sessoes.delete(token);
  }
}

setInterval(limparSessoes, 30 * 60 * 1000).unref();

function autenticar(req, res, next) {
  const cabecalho = req.get('authorization') || '';
  const token = (cabecalho.replace(/^Bearer\s+/i, '') || req.get('x-session-token') || '').trim();
  const registro = token ? sessoes.get(token) : null;
  if (!registro || Date.now() - registro.vistoEm > TTL_SESSAO) {
    if (token) sessoes.delete(token);
    return res.status(401).json({ ok: false, erro: 'Sessão encerrada. Entre novamente.' });
  }
  registro.vistoEm = Date.now();
  req.token = token;
  req.registro = registro;
  req.cotec = registro.cotec;
  return next();
}

function comSessao(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (erro) {
      next(erro);
    }
  };
}

function aulaResumo(aula) {
  return {
    id: aula.id,
    codigo: aula.codigo,
    data: aula.date,
    dataISO: aula.dateISO,
    hora: aula.time,
    professor: aula.professor,
    duracao: aula.duracao,
  };
}

function perfilResumo(perfil = {}) {
  return {
    escola: perfil.escola || null,
    turma: perfil.turma || null,
    componente: perfil.componente || null,
    professor: perfil.professor || null,
    escolaTurma: perfil.escolaTurma || null,
    modulo: perfil.moduloTexto || null,
    moduloId: perfil.modulo || null,
  };
}

function selecaoResumo(cotec, fonte) {
  return typeof cotec.selectionSummary === 'function' ? cotec.selectionSummary(fonte) : null;
}

function diarioResumo(cotec) {
  const diario = cotec.diary;
  if (!diario) return null;
  return {
    titulo: diario.title,
    perfil: perfilResumo({ ...cotec.profile, ...diario.profile }),
    novaAulaDisponivel: Boolean(cotec.newLessonParms),
    aulas: diario.lessons.map(aulaResumo),
  };
}

function traduzirErro(erro) {
  if (erro instanceof CotecError) return { status: erro.status, mensagem: erro.message };
  if (erro instanceof HttpError) return { status: erro.status, mensagem: erro.message };
  if (erro?.name === 'TimeoutError' || erro?.name === 'AbortError') {
    return { status: 504, mensagem: 'O SIGA demorou para responder. Tente novamente em instantes.' };
  }
  if (erro?.cause?.code === 'ENOTFOUND' || erro?.code === 'ENOTFOUND') {
    return { status: 503, mensagem: 'Não foi possível conectar ao SIGA. Verifique sua internet.' };
  }
  return { status: 500, mensagem: erro?.message || 'Erro inesperado no servidor local.' };
}

app.post(
  '/api/login',
  comSessao(async (req, res) => {
    const { login, senha, tipo } = req.body || {};
    if (!login || !senha) throw new HttpError('Informe o CPF/login e a senha do SIGA.');

    const cotec = new CotecSession();
    try {
      await cotec.login(login, senha, tipo || '');
    } catch (erro) {
      const { status, mensagem } = traduzirErro(erro);
      throw new HttpError(mensagem, status);
    }

    const token = crypto.randomUUID();
    sessoes.set(token, { cotec, criadaEm: Date.now(), vistoEm: Date.now() });
    res.json({
      ok: true,
      token,
      perfil: perfilResumo(cotec.profile),
      diario: diarioResumo(cotec),
      selecao: selecaoResumo(cotec),
    });
  }),
);

app.get(
  '/api/status',
  autenticar,
  comSessao(async (req, res) => {
    res.json({
      ok: true,
      perfil: perfilResumo(req.cotec.profile),
      diario: diarioResumo(req.cotec),
      selecao: selecaoResumo(req.cotec),
    });
  }),
);

app.post(
  '/api/opcoes',
  autenticar,
  comSessao(async (req, res) => {
    const { idEscolas, idTurma, idComponente } = req.body || {};
    const pendente = await emFila(req.token, () =>
      req.cotec.prepararSelecao({ idEscolas, idTurma, idComponente }),
    );
    res.json({ ok: true, selecao: selecaoResumo(req.cotec, pendente) });
  }),
);

app.post(
  '/api/selecionar',
  autenticar,
  comSessao(async (req, res) => {
    const { idEscolas, idTurma, idComponente, professorId, modulo } = req.body || {};
    await emFila(req.token, () =>
      req.cotec.selectTurma({ idEscolas, idTurma, idComponente, professorId, modulo }),
    );
    res.json({
      ok: true,
      perfil: perfilResumo(req.cotec.profile),
      diario: diarioResumo(req.cotec),
      selecao: selecaoResumo(req.cotec),
    });
  }),
);

app.post('/api/logout', (req, res) => {
  const cabecalho = req.get('authorization') || '';
  const token = (cabecalho.replace(/^Bearer\s+/i, '') || req.get('x-session-token') || '').trim();
  if (token) sessoes.delete(token);
  res.json({ ok: true });
});

app.get(
  '/api/diario',
  autenticar,
  comSessao(async (req, res) => {
    await emFila(req.token, () => req.cotec.getDiary());
    res.json({
      ok: true,
      perfil: perfilResumo(req.cotec.profile),
      diario: diarioResumo(req.cotec),
      selecao: selecaoResumo(req.cotec),
    });
  }),
);

app.post(
  '/api/aulas/status',
  autenticar,
  comSessao(async (req, res) => {
    const aulas = Array.isArray(req.body?.aulas) ? req.body.aulas : [];
    if (!aulas.length) throw new HttpError('Informe as aulas para conferir a chamada.');
    const status = await emFila(req.token, () => req.cotec.getAttendanceStatus(aulas));
    res.json({ ok: true, aulas: status });
  }),
);

app.post(
  '/api/frequencia/abrir',
  autenticar,
  comSessao(async (req, res) => {
    const { aula } = req.body || {};
    if (!aula) throw new HttpError('Selecione uma aula.');

    const frequencia = await emFila(req.token, () => req.cotec.getFrequency(aula));
    res.json({
      ok: true,
      data: frequencia.date,
      dataISO: frequencia.dateISO,
      aula: aulaResumo(frequencia.lesson),
      alunos: frequencia.students.map((aluno) => ({
        id: aluno.id,
        rowId: aluno.rowValue,
        nome: aluno.name,
        cpf: aluno.cpf,
        matricula: aluno.matricula,
        status: aluno.status,
        justificativa: aluno.justificativa,
      })),
    });
  }),
);

app.post(
  '/api/frequencia/aplicar',
  autenticar,
  comSessao(async (req, res) => {
    const { aula, presentes = [], ausentes = [] } = req.body || {};
    if (!aula) throw new HttpError('Selecione uma aula.');
    if (!Array.isArray(presentes) || !Array.isArray(ausentes)) {
      throw new HttpError('Lista de alunos inválida.');
    }
    if (!presentes.length && !ausentes.length) {
      throw new HttpError('Nenhum aluno marcado. Marque a chamada antes de enviar.');
    }

    const resultado = await emFila(req.token, () =>
      req.cotec.applyFrequency(aula, presentes, ausentes),
    );
    res.json({
      ok: resultado.ok,
      aula: aulaResumo(resultado.lesson),
      presentes: resultado.present,
      ausentes: resultado.absent,
      avisos: resultado.warnings || [],
      divergencias: resultado.mismatches || [],
      mensagem: resultado.message,
    });
  }),
);

app.get(
  '/api/nova-aula',
  autenticar,
  comSessao(async (req, res) => {
    const formulario = await emFila(req.token, () => req.cotec.getNewLessonForm());
    res.json({ ok: true, formulario, perfil: perfilResumo(req.cotec.profile) });
  }),
);

app.post(
  '/api/nova-aula',
  autenticar,
  comSessao(async (req, res) => {
    const dados = req.body || {};
    if (!dados.data_aula) throw new HttpError('Informe a data da aula.');
    if (!dados.hora_inicial) throw new HttpError('Informe o horário inicial.');
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(dados.data_aula))) {
      throw new HttpError('Use a data no formato DD/MM/AAAA.');
    }

    const resultado = await emFila(req.token, () => req.cotec.createLesson(dados));
    res.json({
      ok: true,
      mensagem: resultado.message,
      diario: diarioResumo(req.cotec),
    });
  }),
);

app.get(
  '/api/diagnostico',
  autenticar,
  comSessao(async (req, res) => {
    const debug = req.cotec.getDebug();
    res.json({
      ok: true,
      versao: '1.0.0',
      servidor: { porta: PORTA, uptimeSegundos: Math.round(process.uptime()) },
      sessao: {
        criadaEm: new Date(req.registro.criadaEm).toISOString(),
        ultimoUso: new Date(req.registro.vistoEm).toISOString(),
      },
      perfil: perfilResumo(req.cotec.profile),
      siga: debug,
    });
  }),
);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, erro: 'Rota não encontrada.' });
});

app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  const { status, mensagem } = traduzirErro(erro);
  if (status >= 500) console.error('[erro]', erro);
  if (status === 401) {
    // Sessão do SIGA expirou: descarta a sessão local correspondente.
    const cabecalho = req.get('authorization') || '';
    const token = (cabecalho.replace(/^Bearer\s+/i, '') || req.get('x-session-token') || '').trim();
    if (token && erro instanceof CotecError) sessoes.delete(token);
  }
  res.status(status).json({ ok: false, erro: mensagem });
});

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  app.listen(PORTA, '127.0.0.1', () => {
    console.log('');
    console.log('  COTEC Fácil');
    console.log(`  Abra no navegador: http://localhost:${PORTA}`);
    console.log('  Para encerrar, feche esta janela ou pressione Ctrl+C.');
    console.log('');
  });
}

export { app, sessoes };
