/* ==========================================================================
   COTEC Fácil — lógica do painel
   ========================================================================== */

/* ------------------------------- utilidades ------------------------------ */

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

const CHAVE = {
  token: 'cotec:token',
  cpf: 'cotec:cpf',
  inicio: 'cotec:inicio',
  historico: 'cotec:historico',
  config: 'cotec:config',
  tema: 'cotec:tema',
  modelos: 'cotec:modelos',
  rascunho: (data) => `cotec:rascunho:${data}`,
};

const CONFIG_PADRAO = {
  padraoPresente: true,
  confirmar: true,
  mostrarCpf: false,
  horaPadrao: '18:00',
  qtdePadrao: 4,
};

const estado = {
  token: null,
  perfil: null,
  diario: null,
  data: isoHoje(),
  aulasSelecionadas: new Set(),
  alunos: [],
  marcas: new Map(),
  linhas: new Map(),
  filtro: '',
  aulaBase: null,
  rascunhoPendente: null,
  novaForm: null,
  novaFormEm: 0,
  enviando: false,
  iniciadaEm: null,
  ultimaAtualizacao: null,
  modalTravado: false,
  modalAoFechar: null,
  selecao: null,
  statusAulas: new Map(),
  config: lerJSON(CHAVE.config, { ...CONFIG_PADRAO }),
};

estado.config = { ...CONFIG_PADRAO, ...estado.config };

function lerJSON(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return padrao;
    return JSON.parse(bruto);
  } catch {
    return padrao;
  }
}

function gravarJSON(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* armazenamento indisponível */
  }
}

function removerChave(chave) {
  try {
    localStorage.removeItem(chave);
  } catch {
    /* ignora */
  }
}

function escapar(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function iniciais(nome) {
  const partes = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2);
  return `${partes[0][0]}${partes[partes.length - 1][0]}`;
}

function icone(nome, classe = 'icon') {
  return `<svg class="${classe}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
}

function isoHoje() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(
    agora.getDate(),
  ).padStart(2, '0')}`;
}

function isoParaBR(iso) {
  const [ano, mes, dia] = String(iso || '').split('-');
  if (!ano || !mes || !dia) return '';
  return `${dia}/${mes}/${ano}`;
}

function dataLonga(iso) {
  if (!iso) return '';
  const data = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(data.getTime())) return iso;
  const texto = data.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function somarDias(iso, dias) {
  const data = new Date(`${iso}T12:00:00`);
  data.setDate(data.getDate() + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(
    data.getDate(),
  ).padStart(2, '0')}`;
}

function somarMinutos(hhmm, minutos) {
  const [hora, minuto] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(hora) || Number.isNaN(minuto)) return '';
  const total = (((hora * 60 + minuto + minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function horaCurta(isoString) {
  if (!isoString) return '';
  const data = new Date(isoString);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* --------------------------------- api ---------------------------------- */

async function api(caminho, opcoes = {}) {
  const cabecalhos = { 'Content-Type': 'application/json', ...(opcoes.headers || {}) };
  if (estado.token) cabecalhos.Authorization = `Bearer ${estado.token}`;

  let resposta;
  try {
    resposta = await fetch(caminho, { ...opcoes, headers: cabecalhos });
  } catch {
    throw new Error('Não foi possível falar com o servidor local. Verifique se o COTEC Fácil está aberto.');
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    /* resposta sem JSON */
  }

  if (!resposta.ok) {
    if (resposta.status === 401 && caminho !== '/api/login' && estado.token) {
      expirarSessao(dados?.erro || 'Sua sessão com o SIGA expirou. Entre novamente.');
    }
    const erro = new Error(dados?.erro || `Erro ${resposta.status} ao falar com o servidor.`);
    erro.status = resposta.status;
    throw erro;
  }

  return dados;
}

/* --------------------------------- tema --------------------------------- */

function aplicarTema(tema) {
  const escolhido = ['auto', 'claro', 'escuro'].includes(tema) ? tema : 'auto';
  document.documentElement.dataset.theme = escolhido;
  try {
    localStorage.setItem(CHAVE.tema, escolhido);
  } catch {
    /* ignora */
  }
  $$('.segment[data-tema]').forEach((botao) => {
    botao.classList.toggle('is-on', botao.dataset.tema === escolhido);
    botao.setAttribute('aria-checked', String(botao.dataset.tema === escolhido));
  });
}

function temaEfetivo() {
  const tema = document.documentElement.dataset.theme || 'auto';
  if (tema === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
  }
  return tema;
}

/* -------------------------------- toasts -------------------------------- */

function toast(mensagem, tipo = 'ok', duracao = 4200) {
  const container = $('#toasts');
  const el = document.createElement('div');
  const nomeIcone = tipo === 'ok' ? 'check-square' : 'alert';
  el.className = `toast toast-${tipo}`;
  el.innerHTML = `${icone(nomeIcone)}<span>${escapar(mensagem)}</span>`;
  container.appendChild(el);
  const sumir = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  };
  const temporizador = setTimeout(sumir, duracao);
  el.addEventListener('click', () => {
    clearTimeout(temporizador);
    sumir();
  });
}

/* -------------------------------- modal --------------------------------- */

function abrirModal({ eyebrow = '', titulo, corpo, acoes = [], travado = false, aoFechar = null }) {
  $('#modal-eyebrow').textContent = eyebrow;
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = corpo;
  const rodape = $('#modal-acoes');
  rodape.innerHTML = '';
  for (const acao of acoes) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `btn ${acao.classe || 'btn-ghost'}`;
    botao.textContent = acao.label;
    botao.disabled = Boolean(acao.desabilitado);
    if (acao.onClick) {
      botao.addEventListener('click', () => acao.onClick());
    }
    rodape.appendChild(botao);
  }
  const fechar = $('.modal-head [data-fechar-modal]');
  fechar.disabled = travado;
  estado.modalTravado = travado;
  estado.modalAoFechar = aoFechar;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  const foco = $('#modal-corpo input, #modal-corpo textarea, #modal-acoes .btn:last-child');
  foco?.focus();
}

function fecharModal() {
  const modal = $('#modal');
  if (modal.hidden) return;
  const aoFechar = estado.modalAoFechar;
  estado.modalAoFechar = null;
  estado.modalTravado = false;
  modal.hidden = true;
  document.body.style.overflow = '';
  $('#modal-corpo').innerHTML = '';
  $('#modal-acoes').innerHTML = '';
  if (typeof aoFechar === 'function') aoFechar();
}

function confirmar({ titulo, texto, rotulo = 'Confirmar', perigoso = false }) {
  return new Promise((resolver) => {
    let resolvido = false;
    const concluir = (valor) => {
      if (resolvido) return;
      resolvido = true;
      fecharModal();
      resolver(valor);
    };
    abrirModal({
      titulo,
      corpo: `<p class="page-sub confirmar-texto">${escapar(texto)}</p>`,
      acoes: [
        { label: 'Cancelar', onClick: () => concluir(false) },
        {
          label: rotulo,
          classe: perigoso ? 'btn-primary btn-perigo' : 'btn-primary',
          onClick: () => concluir(true),
        },
      ],
      aoFechar: () => {
        if (!resolvido) {
          resolvido = true;
          resolver(false);
        }
      },
    });
  });
}

/* -------------------------------- login --------------------------------- */

function mostrarErroLogin(mensagem) {
  const erro = $('#login-erro');
  if (!mensagem) {
    erro.hidden = true;
    erro.textContent = '';
    return;
  }
  erro.textContent = mensagem;
  erro.hidden = false;
}

function definirCarregando(botao, ativo) {
  if (!botao) return;
  const rotulo = $('.btn-label-text', botao);
  const spinner = $('.spinner', botao);
  botao.disabled = ativo;
  if (rotulo) rotulo.hidden = ativo;
  if (spinner) spinner.hidden = !ativo;
}

function mostrarLogin(mensagem = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-senha').value = '';
  mostrarErroLogin(mensagem);
  setTimeout(() => $('#login-usuario').focus(), 50);
}

function expirarSessao(mensagem) {
  fecharModal();
  estado.token = null;
  estado.alunos = [];
  estado.marcas = new Map();
  estado.linhas = new Map();
  estado.selecao = null;
  estado.statusAulas.clear();
  statusAulasEmAndamento.clear();
  try {
    sessionStorage.removeItem(CHAVE.token);
    sessionStorage.removeItem(CHAVE.inicio);
  } catch {
    /* ignora */
  }
  mostrarLogin(mensagem || 'Sua sessão expirou. Entre novamente.');
}

async function entrar(evento) {
  evento.preventDefault();
  const login = $('#login-usuario').value.trim();
  const senha = $('#login-senha').value;
  const botao = $('#btn-entrar');

  if (!login || !senha) {
    mostrarErroLogin('Preencha o CPF/login e a senha.');
    return;
  }

  mostrarErroLogin('');
  definirCarregando(botao, true);

  try {
    const dados = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ login, senha }),
    });

    estado.token = dados.token;
    estado.perfil = dados.perfil;
    estado.selecao = dados.selecao || null;
    estado.iniciadaEm = Date.now();
    try {
      sessionStorage.setItem(CHAVE.token, dados.token);
      sessionStorage.setItem(CHAVE.inicio, String(estado.iniciadaEm));
    } catch {
      /* ignora */
    }

    if ($('#login-lembrar').checked) {
      try {
        localStorage.setItem(CHAVE.cpf, login);
      } catch {
        /* ignora */
      }
    } else {
      removerChave(CHAVE.cpf);
    }

    $('#login-senha').value = '';
    abrirApp(dados.diario);
  } catch (erro) {
    mostrarErroLogin(erro.message);
  } finally {
    definirCarregando(botao, false);
  }
}

async function sair() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* segue mesmo assim */
  }
  estado.token = null;
  try {
    sessionStorage.removeItem(CHAVE.token);
    sessionStorage.removeItem(CHAVE.inicio);
  } catch {
    /* ignora */
  }
  estado.perfil = null;
  estado.diario = null;
  estado.selecao = null;
  estado.statusAulas.clear();
  statusAulasEmAndamento.clear();
  estado.aulasSelecionadas.clear();
  limparAlunosUI();
  mostrarLogin('');
  toast('Você saiu da sessão do SIGA.', 'ok');
}

/* --------------------------------- app ---------------------------------- */

function abrirApp(diario) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  aplicarDiario(diario);
  abrirView('chamada');
  atualizarBadge();
  atualizarInfoSessao();
}

function aplicarDiario(diario, { manterData = false } = {}) {
  if (!diario) return;
  estado.diario = diario;
  estado.statusAulas.clear();
  if (diario.perfil) estado.perfil = { ...(estado.perfil || {}), ...diario.perfil };
  estado.ultimaAtualizacao = new Date().toISOString();

  const ids = new Set((diario.aulas || []).map((aula) => aula.id));
  for (const id of [...estado.aulasSelecionadas]) {
    if (!ids.has(id)) estado.aulasSelecionadas.delete(id);
  }

  renderizarPerfil();
  if (!manterData) escolherDataInicial();
  else $('#input-data').value = estado.data;
  renderizarAulas();
  atualizarInfoSessao();
}

function escolherDataInicial() {
  const hoje = isoHoje();
  const datas = [...new Set((estado.diario?.aulas || []).map((aula) => aula.dataISO).filter(Boolean))];
  if (!datas.length) {
    estado.data = hoje;
  } else if (datas.includes(hoje)) {
    estado.data = hoje;
  } else {
    datas.sort((a, b) => {
      const da = Math.abs(new Date(`${a}T12:00:00`) - new Date(`${hoje}T12:00:00`));
      const db = Math.abs(new Date(`${b}T12:00:00`) - new Date(`${hoje}T12:00:00`));
      return da - db;
    });
    estado.data = datas[0];
  }
  $('#input-data').value = estado.data;
  carregarRascunhoNaData();
}

function renderizarPerfil() {
  const perfil = estado.perfil || {};
  $('#perfil-texto').textContent = perfil.componente
    ? `${perfil.componente}${perfil.turma ? ` · ${perfil.turma}` : ''}`
    : perfil.turma || 'Conectado ao SIGA';
  $('#perfil-pill').title = [perfil.escola, perfil.turma, perfil.componente]
    .filter(Boolean)
    .join(' · ');
  $('#sidebar-turma').textContent = perfil.turma || '—';
  $('#sidebar-componente').textContent = perfil.componente || perfil.escola || '—';
}

function atualizarInfoSessao() {
  const desde = estado.iniciadaEm ? horaCurta(new Date(estado.iniciadaEm).toISOString()) : '';
  $('#sessao-info').textContent = desde ? `Sessão ativa desde ${desde}` : 'Sessão ativa';
  $('#about-sessao').textContent = desde ? `desde ${desde}` : '—';
  $('#about-turma').textContent = estado.perfil?.turma || '—';
  $('#about-atualizacao').textContent = estado.ultimaAtualizacao
    ? `às ${horaCurta(estado.ultimaAtualizacao)}`
    : '—';
}

function abrirView(nome) {
  $$('.view').forEach((view) => {
    view.hidden = view.id !== `view-${nome}`;
  });
  $$('.nav-item').forEach((botao) => {
    botao.classList.toggle('is-active', botao.dataset.view === nome);
  });
  $('#app').classList.remove('menu-aberto');

  if (nome === 'historico') renderizarHistorico();
  if (nome === 'config') renderizarConfig();
  if (nome === 'nova') prepararNovaAula();
  if (nome === 'chamada') renderizarAulas();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------- chamada -------------------------------- */

function aulasDoDia() {
  return (estado.diario?.aulas || [])
    .filter((aula) => aula.dataISO === estado.data)
    .slice()
    .sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
}

function aulasSelecionadas() {
  return aulasDoDia().filter((aula) => estado.aulasSelecionadas.has(aula.id));
}

function carregarRascunhoNaData() {
  estado.aulasSelecionadas.clear();
  estado.rascunhoPendente = null;
  const rascunho = lerRascunho(estado.data);
  if (!rascunho) return;
  const ids = new Set(aulasDoDia().map((aula) => aula.id));
  const validos = (rascunho.aulas || []).filter((id) => ids.has(id));
  if (!validos.length) return;
  validos.forEach((id) => estado.aulasSelecionadas.add(id));
  estado.rascunhoPendente = rascunho.marcas || null;
  toast(`Rascunho de ${isoParaBR(estado.data)} recuperado.`, 'warn', 3600);
}

function definirData(novaData) {
  if (!novaData) {
    $('#input-data').value = estado.data;
    return;
  }
  estado.data = novaData;
  $('#input-data').value = novaData;
  limparAlunosUI();
  carregarRascunhoNaData();
  renderizarAulas();
}

function mudarDia(delta) {
  definirData(somarDias(estado.data, delta));
}

const statusAulasEmAndamento = new Set();

function renderizarAulas({ verificar = true } = {}) {
  const lista = $('#lista-aulas');
  const aulas = aulasDoDia();

  if (!aulas.length) {
    lista.innerHTML = `
      <div class="empty">
        ${icone('calendar')}
        <strong>Nenhuma aula em ${escapar(isoParaBR(estado.data))}</strong>
        <p>Escolha outra data ou registre uma nova aula no diário do SIGA.</p>
        <button type="button" class="btn btn-soft btn-sm" data-ir-nova>${icone('plus')} Registrar nova aula</button>
      </div>`;
    const botao = $('[data-ir-nova]', lista);
    botao?.addEventListener('click', () => abrirView('nova'));
    atualizarNotaStatusAulas(aulas);
  } else {
    lista.innerHTML = aulas
      .map((aula, indice) => {
        const selecionada = estado.aulasSelecionadas.has(aula.id);
        const status = estado.statusAulas.get(String(aula.id));
        const semChamada = status?.lancada === false;
        return `
          <label class="lesson ${selecionada ? 'is-selected' : ''} ${
            semChamada ? 'is-pending' : ''
          }" title="${semChamada ? 'Ainda sem frequência lançada no SIGA' : ''}">
            <input type="checkbox" data-aula="${escapar(aula.id)}" ${selecionada ? 'checked' : ''} />
            <span class="lesson-check">${icone('check-square')}</span>
            <span class="lesson-time">
              <strong>${escapar(aula.hora)}</strong>
              <small>${aula.duracao ? `${escapar(aula.duracao)} min` : 'aula'}</small>
            </span>
            <span class="lesson-info">
              <strong>Aula ${indice + 1} do dia</strong>
              <span>${escapar(aula.professor || estado.perfil?.professor || 'Professor')}</span>
            </span>
            <span class="lesson-tag ${semChamada ? 'is-pending' : ''}">${
              semChamada ? 'Sem chamada' : escapar(aula.codigo || 'SIGA')
            }</span>
          </label>`;
      })
      .join('');
    atualizarNotaStatusAulas(aulas);
  }

  atualizarResumoSelecao();
  if (verificar) verificarStatusAulas();
}

function atualizarNotaStatusAulas(aulas = aulasDoDia()) {
  const nota = $('#status-aulas-nota');
  if (!nota) return;
  const pendentes = aulas.filter(
    (aula) => estado.statusAulas.get(String(aula.id))?.lancada === false,
  );
  if (pendentes.length) {
    nota.hidden = false;
    nota.innerHTML = `${icone('alert')}<span>${
      pendentes.length === 1
        ? '1 aula está sem frequência lançada'
        : `${pendentes.length} aulas estão sem frequência lançada`
    } — marcadas em amarelo.</span>`;
    return;
  }
  const erros = aulas.filter((aula) => estado.statusAulas.get(String(aula.id))?.erro).length;
  if (erros) {
    nota.hidden = false;
    nota.innerHTML = `${icone('alert')}<span>Não foi possível conferir ${erros} aula(s). Atualize o diário para tentar de novo.</span>`;
    return;
  }
  nota.hidden = true;
  nota.innerHTML = '';
}

async function verificarStatusAulas() {
  if (!estado.token || !estado.diario) return;
  const aulas = aulasDoDia();
  const faltantes = aulas
    .map((aula) => String(aula.id))
    .filter((id) => !estado.statusAulas.has(id) && !statusAulasEmAndamento.has(id));
  if (!faltantes.length) {
    atualizarNotaStatusAulas(aulas);
    return;
  }

  faltantes.forEach((id) => statusAulasEmAndamento.add(id));
  const nota = $('#status-aulas-nota');
  if (nota) {
    nota.hidden = false;
    nota.innerHTML = `<span class="spinner"></span><span>Conferindo quais aulas ainda estão sem chamada…</span>`;
  }

  try {
    const dados = await api('/api/aulas/status', {
      method: 'POST',
      body: JSON.stringify({ aulas: faltantes }),
    });
    for (const item of dados.aulas || []) {
      estado.statusAulas.set(String(item.id), item);
    }
  } catch (erro) {
    for (const id of faltantes) estado.statusAulas.set(id, { erro: erro.message });
  } finally {
    faltantes.forEach((id) => statusAulasEmAndamento.delete(id));
    renderizarAulas({ verificar: false });
  }
}

function atualizarResumoSelecao() {
  const selecionadas = aulasSelecionadas();
  const total = aulasDoDia().length;
  const botao = $('#btn-carregar-alunos');
  botao.disabled = selecionadas.length === 0;

  const rotuloSelecionar = $('#btn-selecionar-todas');
  if (rotuloSelecionar) {
    rotuloSelecionar.textContent =
      total > 0 && selecionadas.length === total ? 'Desmarcar todas' : 'Selecionar todas';
  }

  const resumo = $('#resumo-selecao');
  if (!selecionadas.length) {
    resumo.textContent = total
      ? 'Nenhuma aula selecionada.'
      : 'Nenhuma aula disponível nesta data.';
    return;
  }
  const primeira = selecionadas[0].hora;
  const ultima = selecionadas[selecionadas.length - 1].hora;
  resumo.textContent =
    selecionadas.length === 1
      ? `1 aula selecionada · ${primeira}`
      : `${selecionadas.length} aulas selecionadas · ${primeira} às ${ultima}`;
}

function alternarTodasAulas() {
  const aulas = aulasDoDia();
  if (!aulas.length) return;
  const todas = aulas.every((aula) => estado.aulasSelecionadas.has(aula.id));
  if (todas) {
    estado.aulasSelecionadas.clear();
    limparAlunosUI();
  } else {
    aulas.forEach((aula) => estado.aulasSelecionadas.add(aula.id));
  }
  renderizarAulas();
  agendarRascunho();
}

async function carregarAlunos() {
  const selecionadas = aulasSelecionadas();
  if (!selecionadas.length) return;
  const aula = selecionadas[0];
  const botao = $('#btn-carregar-alunos');
  definirCarregando(botao, true);

  try {
    const dados = await api('/api/frequencia/abrir', {
      method: 'POST',
      body: JSON.stringify({ aula: aula.id }),
    });

    estado.alunos = dados.alunos || [];
    estado.aulaBase = dados.aula;
    estado.filtro = '';
    $('#busca-aluno').value = '';

    const rascunho = lerRascunho(estado.data);
    const marcasSalvas = rascunho?.marcas || estado.rascunhoPendente || {};
    const marcas = new Map();

    for (const aluno of estado.alunos) {
      const id = String(aluno.id);
      let marca = marcasSalvas[id];
      if (marca !== 'P' && marca !== 'A') {
        if (/PRESENTE/i.test(aluno.status)) marca = 'P';
        else if (/AUSENTE|FALTA/i.test(aluno.status)) marca = 'A';
        else marca = estado.config.padraoPresente ? 'P' : 'A';
      }
      marcas.set(id, marca);
    }
    estado.marcas = marcas;
    estado.rascunhoPendente = null;

    $('#alunos-sub').textContent = `${dataLonga(dados.dataISO)} · ${dados.aula.hora} · ${
      estado.alunos.length
    } alunos · ${selecionadas.length} aula(s)`;
    $('#cont-divergencia').hidden = true;

    renderizarAlunos();
    $('#card-aulas').hidden = true;
    $('#card-alunos').hidden = false;
    atualizarEtapa(2);
    salvarRascunho(true);

    $('#card-alunos').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (erro) {
    toast(erro.message, 'err', 6000);
  } finally {
    definirCarregando(botao, false);
  }
}

function limparAlunosUI() {
  estado.alunos = [];
  estado.marcas = new Map();
  estado.linhas = new Map();
  estado.filtro = '';
  estado.aulaBase = null;
  $('#busca-aluno').value = '';
  $('#lista-alunos').innerHTML = '';
  $('#card-alunos').hidden = true;
  $('#card-aulas').hidden = false;
  $('#cont-divergencia').hidden = true;
  $('#aviso-status').hidden = true;
  atualizarEtapa(1);
}

function voltarParaAulas() {
  $('#card-alunos').hidden = true;
  $('#card-aulas').hidden = false;
  atualizarEtapa(1);
}

function marcaDe(aluno) {
  const marca = estado.marcas.get(String(aluno.id));
  if (marca === 'P' || marca === 'A') return marca;
  return estado.config.padraoPresente ? 'P' : 'A';
}

function renderizarAlunos() {
  const lista = $('#lista-alunos');
  const termo = normalizar(estado.filtro);
  const visiveis = estado.alunos.filter((aluno) => {
    if (!termo) return true;
    const nome = normalizar(aluno.nome);
    const cpf = String(aluno.cpf || '').replace(/\D/g, '');
    const buscaDigitos = estado.filtro.replace(/\D/g, '');
    return nome.includes(termo) || (buscaDigitos && cpf.includes(buscaDigitos));
  });

  if (!visiveis.length) {
    lista.innerHTML = `
      <div class="empty">${icone('users')}<strong>Nenhum aluno encontrado</strong>
      <p>Tente outro nome ou limpe a busca.</p></div>`;
    estado.linhas = new Map();
    atualizarContadores();
    return;
  }

  lista.innerHTML = visiveis.map(linhaAluno).join('');
  estado.linhas = new Map();
  $$('.student', lista).forEach((el) => estado.linhas.set(el.dataset.aluno, el));
  atualizarContadores();
  atualizarAvisoStatus();
}

function atualizarAvisoStatus() {
  const aviso = $('#aviso-status');
  const comStatus = estado.alunos.filter((aluno) => /PRESENTE|AUSENTE|FALTA/i.test(aluno.status));
  if (!comStatus.length) {
    aviso.hidden = true;
    aviso.innerHTML = '';
    return;
  }
  const ausentes = comStatus.filter((aluno) => /AUSENTE|FALTA/i.test(aluno.status)).length;
  if (ausentes > 0) {
    aviso.className = 'call-banner is-warn';
    aviso.innerHTML = `${icone('alert')}<span><strong>${ausentes} aluno(s) já constavam como ausente(s) no SIGA.</strong> Confira abaixo antes de enviar — ou use “Todos presentes” para começar do zero.</span>`;
  } else {
    aviso.className = 'call-banner';
    aviso.innerHTML = `${icone('check-square')}<span>Status atual do SIGA importado: todos presentes. Marque quem faltou.</span>`;
  }
  aviso.hidden = false;
}

function linhaAluno(aluno) {
  const id = String(aluno.id);
  const marca = marcaDe(aluno);
  const meta = estado.config.mostrarCpf && aluno.cpf ? `CPF ${aluno.cpf}` : '';

  return `
    <div class="student ${marca === 'A' ? 'is-absent' : ''}" data-aluno="${escapar(id)}">
      <span class="avatar">${escapar(iniciais(aluno.nome))}</span>
      <span class="student-info">
        <span class="student-name">${escapar(aluno.nome)}</span>
        <span class="student-meta">${escapar(meta)}</span>
      </span>
      <span class="student-status" title="Status atual no SIGA">${
        aluno.status ? escapar(aluno.status) : 'Sem status'
      }</span>
      <span class="segmented" role="group" aria-label="Presença de ${escapar(aluno.nome)}">
        <button type="button" class="segment ${marca === 'P' ? 'is-on' : ''}" data-valor="P"
          aria-pressed="${marca === 'P'}">Presente</button>
        <button type="button" class="segment ${marca === 'A' ? 'is-on' : ''}" data-valor="A"
          aria-pressed="${marca === 'A'}">Ausente</button>
      </span>
    </div>`;
}

function marcarAluno(id, valor) {
  const chave = String(id);
  estado.marcas.set(chave, valor);
  const linha = estado.linhas.get(chave);
  if (linha) {
    linha.classList.toggle('is-absent', valor === 'A');
    const [presente, ausente] = $$('.segment', linha);
    presente.classList.toggle('is-on', valor === 'P');
    presente.setAttribute('aria-pressed', String(valor === 'P'));
    ausente.classList.toggle('is-on', valor === 'A');
    ausente.setAttribute('aria-pressed', String(valor === 'A'));
  }
  atualizarContadores();
  agendarRascunho();
}

function definirTodos(transformar) {
  if (!estado.alunos.length) return;
  for (const aluno of estado.alunos) {
    const chave = String(aluno.id);
    estado.marcas.set(chave, transformar(marcaDe(aluno)));
    const linha = estado.linhas.get(chave);
    if (linha) {
      const valor = estado.marcas.get(chave);
      linha.classList.toggle('is-absent', valor === 'A');
      const [presente, ausente] = $$('.segment', linha);
      presente.classList.toggle('is-on', valor === 'P');
      presente.setAttribute('aria-pressed', String(valor === 'P'));
      ausente.classList.toggle('is-on', valor === 'A');
      ausente.setAttribute('aria-pressed', String(valor === 'A'));
    }
  }
  atualizarContadores();
  agendarRascunho();
}

function contarMarcas() {
  let presentes = 0;
  let ausentes = 0;
  for (const aluno of estado.alunos) {
    if (marcaDe(aluno) === 'A') ausentes += 1;
    else presentes += 1;
  }
  return { presentes, ausentes };
}

function atualizarContadores() {
  const { presentes, ausentes } = contarMarcas();
  $('#cont-presentes').textContent = String(presentes);
  $('#cont-ausentes').textContent = String(ausentes);
  $('#cont-total').textContent = String(estado.alunos.length);

  let mudancas = 0;
  for (const aluno of estado.alunos) {
    const status = /PRESENTE/i.test(aluno.status)
      ? 'P'
      : /AUSENTE|FALTA/i.test(aluno.status)
        ? 'A'
        : null;
    if (status && status !== marcaDe(aluno)) mudancas += 1;
  }
  const divergencia = $('#cont-divergencia');
  divergencia.hidden = mudancas === 0;
  divergencia.textContent = `${mudancas} alteração(ões) em relação ao SIGA`;

  const aulas = aulasSelecionadas().length;
  $('#foot-alunos').textContent = `${estado.alunos.length} alunos · ${ausentes} ausente(s) · ${
    aulas === 1 ? '1 aula selecionada' : `${aulas} aulas selecionadas`
  }`;
}

async function atualizarDiario() {
  const botao = $('#btn-atualizar-diario');
  definirCarregando(botao, true);
  try {
    const dados = await api('/api/diario');
    if (dados.selecao) estado.selecao = dados.selecao;
    aplicarDiario(dados.diario, { manterData: true });
    toast('Diário atualizado com as aulas do SIGA.', 'ok');
  } catch (erro) {
    toast(erro.message, 'err', 6000);
  } finally {
    definirCarregando(botao, false);
  }
}

/* --------------------------- turma / módulo ------------------------------ */

function opcoesSelectHtml(lista = [], selecionado = '') {
  return (lista || [])
    .map((opcao) => {
      const valor = String(opcao.valor ?? '');
      const texto = String(opcao.texto || valor);
      const marcado = valor === String(selecionado) ? 'selected' : '';
      return `<option value="${escapar(valor)}" ${marcado}>${escapar(texto)}</option>`;
    })
    .join('');
}

function abrirSeletorTurma() {
  const selecao = estado.selecao;
  if (!selecao?.atual || !selecao?.opcoes) {
    toast('As opções de turma/módulo ainda não foram carregadas. Atualize o diário.', 'warn');
    return;
  }
  const { atual, opcoes } = selecao;
  const professores = opcoes.professores || [];
  const corpo = `
    <p class="page-sub confirmar-texto">Escolha a escola, a turma e o módulo/componente. Quando um módulo fecha e outro é liberado no SIGA, ele aparece nesta lista.</p>
    <div class="form-grid">
      <label class="field field-wide">
        <span class="field-label">Escola</span>
        <select id="sel-escola">${opcoesSelectHtml(opcoes.escolas, atual.ids?.escola)}</select>
      </label>
      <label class="field">
        <span class="field-label">Turma</span>
        <select id="sel-turma">${opcoesSelectHtml(opcoes.turmas, atual.ids?.turma)}</select>
      </label>
      <label class="field">
        <span class="field-label">Módulo / componente</span>
        <select id="sel-componente">${opcoesSelectHtml(
          opcoes.componentes,
          atual.ids?.componente,
        )}</select>
      </label>
      ${
        professores.length > 1
          ? `<label class="field field-wide">
              <span class="field-label">Vínculo do professor</span>
              <select id="sel-professor">${opcoesSelectHtml(
                professores,
                atual.ids?.professor,
              )}</select>
            </label>`
          : ''
      }
    </div>
    <p class="hint" id="sel-aviso">Módulo atual: ${escapar(atual.componente || '—')}</p>`;

  abrirModal({
    eyebrow: 'Turma e módulo',
    titulo: 'Escolher turma/módulo',
    corpo,
    acoes: [
      { label: 'Cancelar', onClick: () => fecharModal() },
      {
        label: 'Abrir diário',
        classe: 'btn-primary',
        onClick: () => aplicarSelecaoTurma(),
      },
    ],
  });

  $('#sel-escola')?.addEventListener('change', () => carregarOpcoesSeletor(true));
  $('#sel-turma')?.addEventListener('change', () => carregarOpcoesSeletor(false));
  $('#sel-componente')?.addEventListener('change', () => {
    const texto = $('#sel-componente')?.selectedOptions?.[0]?.textContent || '—';
    const aviso = $('#sel-aviso');
    if (aviso) aviso.textContent = `Módulo escolhido: ${texto}`;
  });

  // Recarrega a lista ao abrir para mostrar módulos liberados depois do login.
  carregarOpcoesSeletor(false, true);
}

function atualizarSelectsSeletor(componentePreferido = '') {
  const selecao = estado.selecao;
  if (!selecao?.opcoes) return;
  const { atual, opcoes } = selecao;
  const escola = $('#sel-escola');
  const turma = $('#sel-turma');
  const componente = $('#sel-componente');
  const professor = $('#sel-professor');

  if (escola) escola.innerHTML = opcoesSelectHtml(opcoes.escolas, atual.ids?.escola);
  if (turma) turma.innerHTML = opcoesSelectHtml(opcoes.turmas, atual.ids?.turma);
  if (componente) {
    const valores = new Set((opcoes.componentes || []).map((opcao) => String(opcao.valor)));
    const preferido = valores.has(String(componentePreferido))
      ? componentePreferido
      : atual.ids?.componente;
    componente.innerHTML = opcoesSelectHtml(opcoes.componentes, preferido);
  }
  if (professor) professor.innerHTML = opcoesSelectHtml(opcoes.professores, atual.ids?.professor);
}

async function carregarOpcoesSeletor(escolaMudou = false, manterComponente = false) {
  const idEscolas = $('#sel-escola')?.value;
  const idTurma = escolaMudou ? undefined : $('#sel-turma')?.value;
  const componentePreferido = manterComponente ? $('#sel-componente')?.value || '' : '';
  const aviso = $('#sel-aviso');
  const selects = ['#sel-escola', '#sel-turma', '#sel-componente', '#sel-professor']
    .map((seletor) => $(seletor))
    .filter(Boolean);
  const botaoAplicar = $$('#modal-acoes .btn').at(-1);

  selects.forEach((select) => {
    select.disabled = true;
  });
  if (botaoAplicar) botaoAplicar.disabled = true;
  if (aviso) aviso.textContent = 'Carregando turmas e módulos do SIGA…';

  try {
    const dados = await api('/api/opcoes', {
      method: 'POST',
      body: JSON.stringify({
        idEscolas,
        idTurma,
        idComponente: manterComponente ? componentePreferido : undefined,
      }),
    });
    estado.selecao = dados.selecao || estado.selecao;
    atualizarSelectsSeletor(componentePreferido);
    const texto = $('#sel-componente')?.selectedOptions?.[0]?.textContent || '—';
    if (aviso) aviso.textContent = `Módulo selecionado: ${texto}. Clique em Abrir diário para aplicar.`;
  } catch (erro) {
    if (aviso) aviso.textContent = erro.message;
    toast(erro.message, 'err', 6000);
  } finally {
    selects.forEach((select) => {
      select.disabled = false;
    });
    if (botaoAplicar) botaoAplicar.disabled = false;
  }
}

async function aplicarSelecaoTurma() {
  const idEscolas = $('#sel-escola')?.value;
  const idTurma = $('#sel-turma')?.value;
  const idComponente = $('#sel-componente')?.value;
  const professorId = $('#sel-professor')?.value;
  if (!idEscolas || !idTurma || !idComponente) {
    toast('Escolha a escola, a turma e o módulo/componente.', 'warn');
    return;
  }

  const botao = $$('#modal-acoes .btn').at(-1);
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Abrindo diário…';
  }

  try {
    const dados = await api('/api/selecionar', {
      method: 'POST',
      body: JSON.stringify({ idEscolas, idTurma, idComponente, professorId }),
    });
    estado.selecao = dados.selecao || null;
    estado.perfil = dados.perfil;
    aplicarDiario(dados.diario);
    fecharModal();
    toast('Diário aberto com a turma/módulo escolhido.', 'ok');
  } catch (erro) {
    toast(erro.message, 'err', 6000);
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Abrir diário';
    }
  }
}

/* ------------------------------ rascunhos -------------------------------- */

let temporizadorRascunho = null;

function agendarRascunho() {
  clearTimeout(temporizadorRascunho);
  temporizadorRascunho = setTimeout(() => salvarRascunho(true), 350);
}

function salvarRascunho(silencioso = false) {
  const aulas = [...estado.aulasSelecionadas];
  const marcas = Object.fromEntries(estado.marcas);
  const temConteudo = aulas.length > 0 || Object.keys(marcas).length > 0;
  const chave = CHAVE.rascunho(estado.data);

  if (!temConteudo) {
    removerChave(chave);
    if (!silencioso) toast('Rascunho vazio removido.', 'ok');
    return;
  }

  gravarJSON(chave, {
    data: estado.data,
    aulas,
    marcas,
    atualizadoEm: new Date().toISOString(),
  });
  if (!silencioso) toast(`Rascunho de ${isoParaBR(estado.data)} salvo neste navegador.`, 'ok');
}

function lerRascunho(data) {
  const bruto = lerJSON(CHAVE.rascunho(data), null);
  if (!bruto || bruto.data !== data) return null;
  return bruto;
}

function contarRascunhos() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (chave && chave.startsWith('cotec:rascunho:')) total += 1;
    }
  } catch {
    return 0;
  }
  return total;
}

function limparRascunhos() {
  try {
    const chaves = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (chave && chave.startsWith('cotec:rascunho:')) chaves.push(chave);
    }
    chaves.forEach((chave) => localStorage.removeItem(chave));
  } catch {
    /* ignora */
  }
}

/* ------------------------------- revisão -------------------------------- */

function atualizarEtapa(numero) {
  $$('.step').forEach((passo) => {
    const atual = Number(passo.dataset.step);
    passo.classList.toggle('is-active', atual === numero);
    passo.classList.toggle('is-done', atual < numero);
  });
}

function abrirRevisao() {
  if (!estado.alunos.length) return;
  if (!estado.config.confirmar) {
    enviarChamada(aulasSelecionadas());
    return;
  }

  const aulas = aulasSelecionadas();
  const { presentes, ausentes } = contarMarcas();
  const ausentesNomes = estado.alunos.filter((aluno) => marcaDe(aluno) === 'A');

  const corpo = `
    <div class="review-section">
      <h4>Aulas (${aulas.length})</h4>
      <div class="review-lessons">
        ${aulas
          .map(
            (aula) =>
              `<span class="review-chip">${icone('clock')}${escapar(aula.hora)} · ${escapar(
                isoParaBR(aula.dataISO),
              )}</span>`,
          )
          .join('')}
      </div>
    </div>
    <div class="review-section">
      <h4>Resumo da chamada</h4>
      <div class="review-stats">
        <span class="pill pill-ok">${presentes} presentes</span>
        <span class="pill pill-err">${ausentes} ausentes</span>
        <span class="pill">${estado.alunos.length} alunos</span>
      </div>
    </div>
    ${
      ausentesNomes.length
        ? `<div class="review-section">
            <h4>Ausentes (${ausentesNomes.length})</h4>
            <ul class="review-list">
              ${ausentesNomes
                .map((aluno) => `<li>${icone('x')}${escapar(aluno.nome)}</li>`)
                .join('')}
            </ul>
          </div>`
        : `<div class="review-note">${icone('check-square')}<span>Todos os alunos serão marcados como presentes.</span></div>`
    }
    <div class="review-note">
      ${icone('alert')}
      <span>A mesma chamada será enviada para ${
        aulas.length === 1 ? 'esta aula' : `estas ${aulas.length} aulas`
      }. O painel confere o resultado aluno por aluno depois do envio.</span>
    </div>`;

  abrirModal({
    eyebrow: 'Passo 3 de 3',
    titulo: 'Revisar e enviar chamada',
    corpo,
    acoes: [
      { label: 'Voltar', onClick: () => fecharModal() },
      {
        label: `Enviar para ${aulas.length} ${aulas.length === 1 ? 'aula' : 'aulas'}`,
        classe: 'btn-primary',
        onClick: () => {
          fecharModal();
          enviarChamada(aulas);
        },
      },
    ],
    aoFechar: () => atualizarEtapa(2),
  });
  atualizarEtapa(3);
}

async function enviarChamada(aulas) {
  if (estado.enviando || !aulas.length) return;
  estado.enviando = true;
  atualizarEtapa(3);

  const { presentes, ausentes } = contarMarcas();
  const idsPresentes = estado.alunos.filter((a) => marcaDe(a) === 'P').map((a) => a.id);
  const idsAusentes = estado.alunos.filter((a) => marcaDe(a) === 'A').map((a) => a.id);

  const progressoHtml = aulas
    .map(
      (aula, indice) => `
      <div class="progress-item" data-progresso="${indice}">
        <span class="progress-icon"><span class="spinner"></span></span>
        <span class="progress-text">
          <strong>${escapar(aula.hora)} — ${escapar(isoParaBR(aula.dataISO))}</strong>
          <small>Aguardando envio…</small>
        </span>
      </div>`,
    )
    .join('');

  abrirModal({
    eyebrow: 'Enviando',
    titulo: 'Registrando a chamada no SIGA',
    corpo: `<p class="page-sub confirmar-texto">Não feche esta janela. Cada aula é registrada e conferida separadamente.</p>
      <div class="progress-list">${progressoHtml}</div>`,
    acoes: [{ label: 'Aguarde…', desabilitado: true }],
    travado: true,
  });

  const resultados = [];
  let sessaoExpirada = false;

  for (let indice = 0; indice < aulas.length; indice += 1) {
    const aula = aulas[indice];
    const item = document.querySelector(`[data-progresso="${indice}"]`);

    if (sessaoExpirada) {
      resultados.push({
        aula,
        ok: false,
        mensagem: 'Não enviado — sessão encerrada.',
        presentes: 0,
        ausentes: 0,
      });
      atualizarProgresso(item, 'err', 'Não enviado — sessão encerrada.');
      continue;
    }

    try {
      const resposta = await api('/api/frequencia/aplicar', {
        method: 'POST',
        body: JSON.stringify({ aula: aula.id, presentes: idsPresentes, ausentes: idsAusentes }),
      });

      const detalhe = [
        `${resposta.presentes} presente(s), ${resposta.ausentes} ausente(s)`,
        ...(resposta.divergencias || []),
        ...(resposta.avisos || []),
      ]
        .filter(Boolean)
        .join(' · ');

      resultados.push({
        aula,
        ok: resposta.ok,
        mensagem: detalhe || resposta.mensagem,
        presentes: resposta.presentes,
        ausentes: resposta.ausentes,
        divergencias: resposta.divergencias || [],
        avisos: resposta.avisos || [],
      });

      estado.statusAulas.set(String(aula.id), {
        lancada: true,
        presentes: resposta.presentes,
        ausentes: resposta.ausentes,
        total: estado.alunos.length,
      });

      atualizarProgresso(item, resposta.ok ? 'ok' : 'err', detalhe || resposta.mensagem);
    } catch (erro) {
      resultados.push({
        aula,
        ok: false,
        mensagem: erro.message,
        presentes: 0,
        ausentes: 0,
      });
      atualizarProgresso(item, 'err', erro.message);
      if (erro.status === 401) sessaoExpirada = true;
    }
  }

  estado.enviando = false;
  const sucessos = resultados.filter((r) => r.ok).length;
  const falhas = resultados.length - sucessos;

  registrarHistorico(resultados, { presentes, ausentes });

  if (sucessos > 0) {
    clearTimeout(temporizadorRascunho);
    temporizadorRascunho = null;
    removerChave(CHAVE.rascunho(estado.data));
    estado.rascunhoPendente = null;
  }

  if (sessaoExpirada) {
    toast(
      sucessos > 0
        ? 'A sessão do SIGA expirou durante o envio. Entre novamente para conferir as aulas restantes.'
        : 'A sessão do SIGA expirou. Entre novamente para enviar a chamada.',
      'err',
      8000,
    );
    return;
  }

  const corpoFinal = `
    <div class="review-stats" style="margin-bottom:14px">
      <span class="pill pill-ok">${sucessos} aula(s) registrada(s)</span>
      ${falhas ? `<span class="pill pill-err">${falhas} com problema</span>` : ''}
      <span class="pill">${presentes} presentes · ${ausentes} ausentes</span>
    </div>
    <div class="progress-list">
      ${resultados
        .map(
          (resultado) => `
        <div class="progress-item ${resultado.ok ? 'is-ok' : 'is-err'}">
          <span class="progress-icon">${icone(resultado.ok ? 'check-square' : 'alert')}</span>
          <span class="progress-text">
            <strong>${escapar(resultado.aula.hora)} — ${escapar(
              isoParaBR(resultado.aula.dataISO),
            )}</strong>
            <small>${escapar(resultado.mensagem)}</small>
          </span>
        </div>`,
        )
        .join('')}
    </div>
    ${
      falhas
        ? `<div class="review-note is-warn" style="margin-top:14px">${icone('alert')}<span>As aulas com problema não foram confirmadas. Você pode conferir no SIGA e tentar novamente.</span></div>`
        : `<div class="review-note" style="margin-top:14px">${icone('check-square')}<span>A chamada foi registrada e conferida no SIGA.</span></div>`
    }`;

  const acoes = [];
  if (sucessos > 0) {
    acoes.push({
      label: 'Ver histórico',
      classe: 'btn-ghost',
      onClick: () => {
        fecharModal();
        resetarChamada();
        abrirView('historico');
      },
    });
    acoes.push({
      label: 'Concluir',
      classe: 'btn-primary',
      onClick: () => {
        fecharModal();
        resetarChamada();
        toast('Chamada concluída. Bom trabalho!', 'ok');
      },
    });
  } else {
    acoes.push({
      label: 'Fechar',
      classe: 'btn-primary',
      onClick: () => {
        fecharModal();
        atualizarEtapa(2);
      },
    });
  }

  abrirModal({
    eyebrow: sucessos === resultados.length ? 'Concluído' : 'Atenção',
    titulo:
      sucessos === resultados.length
        ? 'Chamada registrada com sucesso'
        : sucessos > 0
          ? 'Chamada registrada em parte'
          : 'Não foi possível registrar a chamada',
    corpo: corpoFinal,
    acoes,
    aoFechar: () => {
      if (sucessos > 0) resetarChamada();
      else atualizarEtapa(2);
    },
  });

  if (sucessos > 0) {
    toast(
      sucessos === resultados.length
        ? 'Chamada registrada no SIGA.'
        : `Chamada registrada em ${sucessos} de ${resultados.length} aulas.`,
      'ok',
    );
  }
}

function atualizarProgresso(item, tipo, mensagem) {
  if (!item) return;
  item.classList.remove('is-ok', 'is-err');
  if (tipo === 'ok') item.classList.add('is-ok');
  if (tipo === 'err') item.classList.add('is-err');
  const iconeEl = $('.progress-icon', item);
  if (iconeEl) iconeEl.innerHTML = icone(tipo === 'ok' ? 'check-square' : 'alert');
  const detalhe = $('.progress-text small', item);
  if (detalhe) detalhe.textContent = mensagem;
}

function resetarChamada() {
  clearTimeout(temporizadorRascunho);
  temporizadorRascunho = null;
  estado.aulasSelecionadas.clear();
  limparAlunosUI();
  renderizarAulas();
}

/* ------------------------------- histórico ------------------------------- */

function carregarHistorico() {
  const historico = lerJSON(CHAVE.historico, []);
  return Array.isArray(historico) ? historico : [];
}

function registrarHistorico(resultados, { presentes, ausentes }) {
  const historico = carregarHistorico();
  const sucesso = resultados.filter((r) => r.ok).length;
  const entrada = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    criadoEm: new Date().toISOString(),
    dataAula: estado.data,
    perfil: {
      turma: estado.perfil?.turma || null,
      componente: estado.perfil?.componente || null,
    },
    totalPresentes: presentes,
    totalAusentes: ausentes,
    totalAlunos: estado.alunos.length,
    status:
      sucesso === resultados.length ? 'ok' : sucesso > 0 ? 'parcial' : 'erro',
    aulas: resultados.map((resultado) => ({
      hora: resultado.aula.hora,
      ok: resultado.ok,
      mensagem: resultado.mensagem,
      avisos: resultado.avisos || [],
      divergencias: resultado.divergencias || [],
    })),
  };

  historico.unshift(entrada);
  gravarJSON(CHAVE.historico, historico.slice(0, 100));
  atualizarBadge();
}

function atualizarBadge() {
  const total = carregarHistorico().length;
  const badge = $('#nav-badge-historico');
  badge.hidden = total === 0;
  badge.textContent = total > 99 ? '99+' : String(total);
}

function renderizarHistorico() {
  const historico = carregarHistorico();
  const lista = $('#historico-lista');

  if (!historico.length) {
    lista.innerHTML = `
      <div class="hist-empty">
        ${icone('clock')}
        <strong>Nenhum envio registrado ainda</strong>
        <p>Quando você enviar uma chamada, o resumo aparece aqui.</p>
      </div>`;
    return;
  }

  lista.innerHTML = historico
    .map((entrada) => {
      const data = String(entrada.dataAula || '').split('-');
      const dia = data[2] || '—';
      const mes = data[1]
        ? new Date(`${entrada.dataAula}T12:00:00`)
            .toLocaleDateString('pt-BR', { month: 'short' })
            .replace('.', '')
        : '—';
      const aulas = entrada.aulas || [];
      const horas = aulas.map((a) => a.hora).filter(Boolean);
      const horario =
        horas.length === 1 ? horas[0] : horas.length > 1 ? `${horas[0]}–${horas[horas.length - 1]}` : '';
      const rotuloStatus =
        entrada.status === 'ok' ? 'Enviado' : entrada.status === 'parcial' ? 'Parcial' : 'Falhou';
      const classeStatus =
        entrada.status === 'ok' ? 'pill-ok' : entrada.status === 'parcial' ? 'pill-warn' : 'pill-err';

      return `
        <details class="hist-item">
          <summary class="hist-head">
            <span class="hist-date"><strong>${escapar(dia)}</strong><span>${escapar(mes)}</span></span>
            <span class="hist-main">
              <span class="hist-title">${escapar(
                entrada.perfil?.turma || estado.perfil?.turma || 'Chamada',
              )} · ${aulas.length} ${aulas.length === 1 ? 'aula' : 'aulas'}</span>
              <span class="hist-sub">${escapar(horario)} · enviado às ${escapar(
                horaCurta(entrada.criadoEm),
              )}</span>
            </span>
            <span class="hist-stats">
              <span class="pill pill-ok">${Number(entrada.totalPresentes) || 0} P</span>
              <span class="pill pill-err">${Number(entrada.totalAusentes) || 0} A</span>
              <span class="pill ${classeStatus}">${rotuloStatus}</span>
            </span>
          </summary>
          <div class="hist-body">
            <div class="hist-lessons">
              ${aulas
                .map(
                  (aula) => `
                <div class="hist-lesson">
                  ${icone(aula.ok ? 'check-square' : 'alert')}
                  <span>${escapar(aula.hora || '—')}</span>
                  <span class="hist-lesson-msg">${escapar(aula.mensagem || '')}</span>
                </div>`,
                )
                .join('')}
            </div>
          </div>
        </details>`;
    })
    .join('');
}

function exportarHistorico() {
  const historico = carregarHistorico();
  if (!historico.length) {
    toast('Não há histórico para exportar.', 'warn');
    return;
  }
  const conteudo = JSON.stringify(
    { exportadoEm: new Date().toISOString(), registros: historico },
    null,
    2,
  );
  const blob = new Blob([conteudo], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cotec-historico-${isoHoje()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Histórico exportado em JSON.', 'ok');
}

async function limparHistorico() {
  const confirmado = await confirmar({
    titulo: 'Limpar histórico',
    texto: 'Todos os registros de envio deste navegador serão apagados. Essa ação não pode ser desfeita.',
    rotulo: 'Limpar histórico',
    perigoso: true,
  });
  if (!confirmado) return;
  removerChave(CHAVE.historico);
  atualizarBadge();
  renderizarHistorico();
  toast('Histórico apagado.', 'ok');
}

/* ------------------------------- nova aula ------------------------------- */

function duracaoAula() {
  const valor = Number(estado.diario?.aulas?.[0]?.duracao);
  return Number.isFinite(valor) && valor > 0 ? valor : 60;
}

function prepararNovaAula() {
  const agora = Date.now();
  if (!estado.novaForm || agora - estado.novaFormEm > 5 * 60 * 1000) {
    carregarFormularioNova();
  } else {
    preencherNovaAula();
  }
}

async function carregarFormularioNova() {
  try {
    const dados = await api('/api/nova-aula');
    estado.novaForm = dados.formulario;
    estado.novaFormEm = Date.now();
    preencherNovaAula();
  } catch (erro) {
    exibirErroNova(erro.message);
    toast(erro.message, 'err', 6000);
  }
}

function preencherNovaAula() {
  const form = estado.novaForm;
  if (!form) return;
  if (!$('#nova-data').value) {
    $('#nova-data').value = estado.diario?.aulas?.some((a) => a.dataISO === estado.data)
      ? estado.data
      : isoHoje();
  }
  if (!$('#nova-hora').value) {
    $('#nova-hora').value = estado.config.horaPadrao || form.hora_inicial || '18:00';
  }
  const qtde = Number($('#nova-qtde').value) || estado.config.qtdePadrao || 4;
  $('#nova-qtde').value = String(qtde);
  renderizarConteudos(qtde);
}

function renderizarConteudos(qtde, valores = null) {
  const container = $('#nova-conteudos');
  const quantidade = Math.max(1, Math.min(8, Number(qtde) || 1));
  const anteriores = valores || coletarConteudos();
  const hora = $('#nova-hora').value || '18:00';
  const duracao = duracaoAula();

  container.innerHTML = Array.from({ length: quantidade }, (_, indice) => {
    const conteudo = anteriores[indice]?.conteudo || '';
    const observacoes = anteriores[indice]?.observacoes || '';
    return `
      <div class="lesson-block">
        <div class="lesson-block-head">
          <span class="lesson-block-title"><span class="badge">${indice + 1}</span> Aula ${
            indice + 1
          }</span>
          <span class="lesson-block-time" data-hora-bloco="${indice}">${escapar(
            somarMinutos(hora, indice * duracao),
          )}</span>
        </div>
        <div class="lesson-block-body">
          <label class="field">
            <span class="field-label">Conteúdo</span>
            <textarea rows="2" data-conteudo="${indice}" placeholder="O que foi trabalhado nesta aula?">${escapar(
              conteudo,
            )}</textarea>
          </label>
          <label class="field">
            <span class="field-label">Observações</span>
            <input type="text" data-observacoes="${indice}" placeholder="Opcional" value="${escapar(
              observacoes,
            )}" />
          </label>
        </div>
      </div>`;
  }).join('');

  atualizarHorariosBlocos();
}

function atualizarHorariosBlocos() {
  const hora = $('#nova-hora').value || '18:00';
  const duracao = duracaoAula();
  $$('[data-hora-bloco]').forEach((el, indice) => {
    el.textContent = somarMinutos(hora, indice * duracao);
  });
}

function coletarConteudos() {
  const conteudos = $$('[data-conteudo]').map((el, indice) => ({
    conteudo: el.value.trim(),
    observacoes: ($(`[data-observacoes="${indice}"]`)?.value || '').trim(),
  }));
  return conteudos;
}

function exibirErroNova(mensagem) {
  const erro = $('#nova-erro');
  if (!mensagem) {
    erro.hidden = true;
    erro.textContent = '';
    return;
  }
  erro.textContent = mensagem;
  erro.hidden = false;
}

function limparNovaAula() {
  $$('[data-conteudo]').forEach((el) => {
    el.value = '';
  });
  $$('[data-observacoes]').forEach((el) => {
    el.value = '';
  });
  ['#nova-objetivo', '#nova-metodologia', '#nova-recursos', '#nova-bibliografia', '#nova-avaliacao'].forEach(
    (seletor) => {
      $(seletor).value = '';
    },
  );
  exibirErroNova('');
  $('#nova-sucesso').hidden = true;
  toast('Campos limpos.', 'ok');
}

async function salvarNovaAula(evento) {
  evento.preventDefault();
  const dataISO = $('#nova-data').value;
  const hora = $('#nova-hora').value;
  const qtde = Number($('#nova-qtde').value) || 1;

  if (!dataISO || !hora) {
    exibirErroNova('Informe a data e o horário inicial da aula.');
    return;
  }

  exibirErroNova('');
  const botao = $('#btn-salvar-aula');
  definirCarregando(botao, true);
  const conteudos = coletarConteudos();

  const dados = {
    data_aula: isoParaBR(dataISO),
    hora_inicial: hora,
    qtde,
    conteudo: Array.from({ length: qtde }, (_, indice) => conteudos[indice] || { conteudo: '', observacoes: '' }),
    objetivo: $('#nova-objetivo').value.trim(),
    metodologia: $('#nova-metodologia').value.trim(),
    recursos_didaticos: $('#nova-recursos').value.trim(),
    bibliografia: $('#nova-bibliografia').value.trim(),
    avaliacao: $('#nova-avaliacao').value.trim(),
  };

  try {
    const resposta = await api('/api/nova-aula', {
      method: 'POST',
      body: JSON.stringify(dados),
    });

    if (resposta.diario) {
      estado.diario = resposta.diario;
      if (resposta.diario.perfil) {
        estado.perfil = { ...(estado.perfil || {}), ...resposta.diario.perfil };
      }
      renderizarPerfil();
    }

    $('#nova-sucesso').hidden = false;
    $('#nova-sucesso-titulo').textContent = 'Aula registrada no SIGA';
    $('#nova-sucesso-texto').textContent = `${qtde} ${qtde === 1 ? 'aula criada' : 'aulas criadas'} em ${isoParaBR(
      dataISO,
    )} às ${hora}.`;

    // Limpa apenas os conteúdos; data, horário e plano continuam para a próxima.
    $$('[data-conteudo]').forEach((el) => {
      el.value = '';
    });
    $$('[data-observacoes]').forEach((el) => {
      el.value = '';
    });
    estado.novaForm = null;
    estado.novaFormEm = 0;
    estado.ultimaAtualizacao = new Date().toISOString();
    atualizarInfoSessao();
    toast('Aula criada com sucesso no diário.', 'ok');
  } catch (erro) {
    exibirErroNova(erro.message);
    toast(erro.message, 'err', 6000);
  } finally {
    definirCarregando(botao, false);
  }
}

function irParaChamadaDaNova() {
  const dataISO = $('#nova-data').value || isoHoje();
  abrirView('chamada');
  definirData(dataISO);
  const aulas = aulasDoDia();
  aulas.forEach((aula) => estado.aulasSelecionadas.add(aula.id));
  renderizarAulas();
  if (aulas.length) {
    toast(`${aulas.length} aula(s) de ${isoParaBR(dataISO)} selecionada(s) para a chamada.`, 'ok');
  }
}

/* -------------------------------- modelos -------------------------------- */

function carregarModelos() {
  const modelos = lerJSON(CHAVE.modelos, []);
  return Array.isArray(modelos) ? modelos : [];
}

function salvarModeloAtual() {
  const corpo = `
    <p class="page-sub confirmar-texto">O modelo guarda objetivo, metodologia, recursos, bibliografia e avaliação.</p>
    <label class="field">
      <span class="field-label">Nome do modelo</span>
      <input type="text" id="modelo-nome" value="Plano padrão" maxlength="60" />
    </label>`;

  abrirModal({
    eyebrow: 'Modelo',
    titulo: 'Salvar plano como modelo',
    corpo,
    acoes: [
      { label: 'Cancelar', onClick: () => fecharModal() },
      {
        label: 'Salvar modelo',
        classe: 'btn-primary',
        onClick: () => {
          const nome = $('#modelo-nome')?.value.trim() || 'Plano padrão';
          const modelos = carregarModelos();
          const modelo = {
            nome,
            objetivo: $('#nova-objetivo').value.trim(),
            metodologia: $('#nova-metodologia').value.trim(),
            recursos: $('#nova-recursos').value.trim(),
            bibliografia: $('#nova-bibliografia').value.trim(),
            avaliacao: $('#nova-avaliacao').value.trim(),
            atualizadoEm: new Date().toISOString(),
          };
          const indice = modelos.findIndex((item) => normalizar(item.nome) === normalizar(nome));
          if (indice >= 0) modelos[indice] = modelo;
          else modelos.unshift(modelo);
          gravarJSON(CHAVE.modelos, modelos.slice(0, 20));
          fecharModal();
          toast(`Modelo "${nome}" salvo.`, 'ok');
        },
      },
    ],
  });
}

function abrirModelos() {
  const modelos = carregarModelos();
  const corpo = modelos.length
    ? `<p class="page-sub confirmar-texto">Escolha um modelo para preencher o plano de aula.</p>
       <ul class="review-list" style="max-height:260px">
         ${modelos
           .map(
             (modelo, indice) => `
           <li>
             ${icone('save')}
             <span style="flex:1;min-width:0">
               <strong style="display:block;font-size:.84rem">${escapar(modelo.nome)}</strong>
               <small style="color:var(--muted);font-size:.72rem">${escapar(
                 (modelo.atualizadoEm || '').slice(0, 10).split('-').reverse().join('/'),
               )}</small>
             </span>
             <button type="button" class="btn btn-soft btn-sm" data-aplicar-modelo="${indice}">Usar</button>
             <button type="button" class="btn btn-ghost btn-sm btn-danger" data-excluir-modelo="${indice}" aria-label="Excluir modelo">${icone(
               'trash',
             )}</button>
           </li>`,
           )
           .join('')}
       </ul>`
    : `<div class="empty">${icone('save')}<strong>Nenhum modelo salvo</strong><p>Preencha o plano de aula e use “Salvar modelo”.</p></div>`;

  abrirModal({
    eyebrow: 'Modelo',
    titulo: 'Carregar plano de aula',
    corpo,
    acoes: [
      { label: 'Fechar', onClick: () => fecharModal() },
      { label: 'Salvar o plano atual', classe: 'btn-primary', onClick: () => { fecharModal(); salvarModeloAtual(); } },
    ],
  });

  $$('[data-aplicar-modelo]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const modelo = carregarModelos()[Number(botao.dataset.aplicarModelo)];
      if (!modelo) return;
      $('#nova-objetivo').value = modelo.objetivo || '';
      $('#nova-metodologia').value = modelo.metodologia || '';
      $('#nova-recursos').value = modelo.recursos || '';
      $('#nova-bibliografia').value = modelo.bibliografia || '';
      $('#nova-avaliacao').value = modelo.avaliacao || '';
      $('.plan-details').open = true;
      fecharModal();
      toast(`Modelo "${modelo.nome}" aplicado.`, 'ok');
    });
  });

  $$('[data-excluir-modelo]').forEach((botao) => {
    botao.addEventListener('click', async () => {
      const indice = Number(botao.dataset.excluirModelo);
      const modelosAtuais = carregarModelos();
      const modelo = modelosAtuais[indice];
      if (!modelo) return;
      const confirmado = await confirmar({
        titulo: 'Excluir modelo',
        texto: `O modelo "${modelo.nome}" será removido deste navegador.`,
        rotulo: 'Excluir',
        perigoso: true,
      });
      if (!confirmado) {
        abrirModelos();
        return;
      }
      modelosAtuais.splice(indice, 1);
      gravarJSON(CHAVE.modelos, modelosAtuais);
      toast('Modelo excluído.', 'ok');
      abrirModelos();
    });
  });
}

/* ----------------------------- configurações ----------------------------- */

function renderizarConfig() {
  const config = estado.config;
  $('#conf-padrao-presente').checked = Boolean(config.padraoPresente);
  $('#conf-confirmar').checked = Boolean(config.confirmar);
  $('#conf-mostrar-cpf').checked = Boolean(config.mostrarCpf);
  $('#conf-hora-padrao').value = config.horaPadrao || '';
  $('#conf-qtde-padrao').value = String(config.qtdePadrao || 4);

  const tema = document.documentElement.dataset.theme || 'auto';
  $$('.segment[data-tema]').forEach((botao) => {
    botao.classList.toggle('is-on', botao.dataset.tema === tema);
    botao.setAttribute('aria-checked', String(botao.dataset.tema === tema));
  });

  const rascunhos = contarRascunhos();
  $('#conf-rascunhos-info').textContent = rascunhos
    ? `${rascunhos} rascunho(s) salvo(s) neste navegador.`
    : 'Nenhum rascunho salvo.';

  atualizarInfoSessao();
}

function salvarConfig() {
  estado.config = {
    padraoPresente: $('#conf-padrao-presente').checked,
    confirmar: $('#conf-confirmar').checked,
    mostrarCpf: $('#conf-mostrar-cpf').checked,
    horaPadrao: $('#conf-hora-padrao').value || '18:00',
    qtdePadrao: Number($('#conf-qtde-padrao').value) || 4,
  };
  gravarJSON(CHAVE.config, estado.config);
  if (estado.alunos.length) renderizarAlunos();
}

async function limparTodosOsDados() {
  const confirmado = await confirmar({
    titulo: 'Apagar dados locais',
    texto:
      'Histórico, rascunhos, modelos de plano e preferências serão apagados deste navegador. A sessão com o SIGA continua ativa.',
    rotulo: 'Apagar tudo',
    perigoso: true,
  });
  if (!confirmado) return;

  try {
    const chaves = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (chave && chave.startsWith('cotec:')) chaves.push(chave);
    }
    chaves.forEach((chave) => localStorage.removeItem(chave));
  } catch {
    /* ignora */
  }

  estado.config = { ...CONFIG_PADRAO };
  estado.rascunhoPendente = null;
  estado.aulasSelecionadas.clear();
  limparAlunosUI();
  renderizarAulas();
  aplicarTema('auto');
  renderizarConfig();
  atualizarBadge();
  toast('Dados locais apagados.', 'ok');
}

async function abrirDiagnostico(evento) {
  evento?.preventDefault();
  try {
    const dados = await api('/api/diagnostico');
    abrirModal({
      eyebrow: 'Suporte',
      titulo: 'Diagnóstico da conexão',
      corpo: `
        <div class="review-section">
          <h4>Servidor local</h4>
          <p class="page-sub">Porta ${escapar(dados.servidor?.porta)} · no ar há ${Math.round(
            (dados.servidor?.uptimeSegundos || 0) / 60,
          )} min</p>
        </div>
        <div class="review-section">
          <h4>Últimas requisições ao SIGA</h4>
          <pre class="code-block">${escapar(JSON.stringify(dados.siga?.requests || [], null, 2))}</pre>
        </div>`,
      acoes: [{ label: 'Fechar', classe: 'btn-primary', onClick: () => fecharModal() }],
    });
  } catch (erro) {
    toast(erro.message, 'err', 6000);
  }
}

/* -------------------------------- eventos -------------------------------- */

function ligarEventos() {
  $('#form-login').addEventListener('submit', entrar);

  $('#btn-mostrar-senha').addEventListener('click', () => {
    const campo = $('#login-senha');
    const visivel = campo.type === 'text';
    campo.type = visivel ? 'password' : 'text';
    $('#btn-mostrar-senha').setAttribute('aria-label', visivel ? 'Mostrar senha' : 'Ocultar senha');
    $('#btn-mostrar-senha').innerHTML = icone(visivel ? 'eye' : 'eye-off');
    campo.focus();
  });

  $$('.nav-item').forEach((botao) => {
    botao.addEventListener('click', () => abrirView(botao.dataset.view));
  });

  $('#btn-menu').addEventListener('click', () => {
    $('#app').classList.toggle('menu-aberto');
  });

  $('#btn-tema').addEventListener('click', () => {
    aplicarTema(temaEfetivo() === 'escuro' ? 'claro' : 'escuro');
    renderizarConfig();
  });

  $('#btn-sair').addEventListener('click', sair);
  $('#btn-atualizar-diario').addEventListener('click', atualizarDiario);
  $$('[data-trocar-turma]').forEach((botao) => {
    botao.addEventListener('click', abrirSeletorTurma);
  });
  $('#link-diagnostico').addEventListener('click', abrirDiagnostico);

  $('#input-data').addEventListener('change', (evento) => {
    definirData(evento.target.value);
  });
  $('#btn-dia-anterior').addEventListener('click', () => mudarDia(-1));
  $('#btn-proximo-dia').addEventListener('click', () => mudarDia(1));
  $('#btn-hoje').addEventListener('click', () => definirData(isoHoje()));

  $('#btn-selecionar-todas').addEventListener('click', alternarTodasAulas);
  $('#btn-carregar-alunos').addEventListener('click', carregarAlunos);
  $('#btn-voltar-aulas').addEventListener('click', voltarParaAulas);

  $('#lista-aulas').addEventListener('change', (evento) => {
    const entrada = evento.target.closest('input[data-aula]');
    if (!entrada) return;
    const id = entrada.dataset.aula;
    if (entrada.checked) estado.aulasSelecionadas.add(id);
    else estado.aulasSelecionadas.delete(id);
    entrada.closest('.lesson').classList.toggle('is-selected', entrada.checked);
    atualizarResumoSelecao();
    if (!estado.aulasSelecionadas.size) limparAlunosUI();
    agendarRascunho();
  });

  $('#lista-alunos').addEventListener('click', (evento) => {
    const botao = evento.target.closest('.segment[data-valor]');
    if (!botao) return;
    const linha = botao.closest('.student');
    if (!linha) return;
    marcarAluno(linha.dataset.aluno, botao.dataset.valor);
  });

  $('#btn-todos-presentes').addEventListener('click', () => definirTodos(() => 'P'));
  $('#btn-todos-ausentes').addEventListener('click', () => definirTodos(() => 'A'));
  $('#btn-inverter').addEventListener('click', () =>
    definirTodos((marca) => (marca === 'P' ? 'A' : 'P')),
  );

  $('#busca-aluno').addEventListener('input', (evento) => {
    estado.filtro = evento.target.value;
    renderizarAlunos();
  });

  $('#btn-salvar-rascunho').addEventListener('click', () => salvarRascunho(false));
  $('#btn-revisar').addEventListener('click', abrirRevisao);

  $('#form-nova-aula').addEventListener('submit', salvarNovaAula);
  $('#nova-qtde').addEventListener('change', (evento) => {
    renderizarConteudos(Number(evento.target.value));
  });
  $('#nova-hora').addEventListener('input', atualizarHorariosBlocos);
  $('#btn-limpar-nova').addEventListener('click', limparNovaAula);
  $('#btn-modelo-salvar').addEventListener('click', salvarModeloAtual);
  $('#btn-modelo-carregar').addEventListener('click', abrirModelos);
  $('#btn-nova-outra').addEventListener('click', () => {
    $('#nova-sucesso').hidden = true;
    $('#nova-data').focus();
  });
  $('#btn-ir-chamada').addEventListener('click', irParaChamadaDaNova);

  $('#btn-exportar-historico').addEventListener('click', exportarHistorico);
  $('#btn-limpar-historico').addEventListener('click', limparHistorico);

  ['#conf-padrao-presente', '#conf-confirmar', '#conf-mostrar-cpf', '#conf-hora-padrao', '#conf-qtde-padrao'].forEach(
    (seletor) => {
      $(seletor).addEventListener('change', salvarConfig);
    },
  );

  $$('.segment[data-tema]').forEach((botao) => {
    botao.addEventListener('click', () => {
      aplicarTema(botao.dataset.tema);
      renderizarConfig();
    });
  });

  $('#btn-limpar-rascunhos').addEventListener('click', async () => {
    const confirmado = await confirmar({
      titulo: 'Limpar rascunhos',
      texto: 'Os rascunhos de chamada salvos neste navegador serão apagados.',
      rotulo: 'Limpar rascunhos',
      perigoso: true,
    });
    if (!confirmado) return;
    limparRascunhos();
    renderizarConfig();
    toast('Rascunhos apagados.', 'ok');
  });

  $('#btn-limpar-tudo').addEventListener('click', limparTodosOsDados);

  $$('[data-fechar-modal]').forEach((elemento) => {
    elemento.addEventListener('click', () => {
      if (!estado.modalTravado) fecharModal();
    });
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !$('#modal').hidden && !estado.modalTravado) fecharModal();
    if (evento.key === 'Enter' && !$('#modal').hidden) {
      const campo = document.activeElement;
      if (campo?.id === 'modelo-nome') {
        const acao = $$('#modal-acoes .btn').at(-1);
        acao?.click();
      }
    }
  });
}

/* ------------------------------ inicialização ---------------------------- */

async function restaurarSessao() {
  let token = null;
  try {
    token = sessionStorage.getItem(CHAVE.token);
  } catch {
    token = null;
  }
  if (!token) {
    mostrarLogin('');
    return;
  }

  estado.token = token;
  try {
    const dados = await api('/api/status');
    estado.perfil = dados.perfil;
    estado.selecao = dados.selecao || null;
    estado.iniciadaEm = Number(sessionStorage.getItem(CHAVE.inicio)) || Date.now();
    abrirApp(dados.diario);
  } catch {
    const jaTratado = estado.token === null;
    estado.token = null;
    try {
      sessionStorage.removeItem(CHAVE.token);
      sessionStorage.removeItem(CHAVE.inicio);
    } catch {
      /* ignora */
    }
    if (!jaTratado) mostrarLogin('');
  }
}

function iniciar() {
  let tema = 'auto';
  try {
    tema = localStorage.getItem(CHAVE.tema) || 'auto';
  } catch {
    tema = 'auto';
  }
  aplicarTema(tema);

  try {
    const cpf = localStorage.getItem(CHAVE.cpf);
    if (cpf) {
      $('#login-usuario').value = cpf;
      $('#login-lembrar').checked = true;
      $('#login-senha').focus();
    }
  } catch {
    /* ignora */
  }

  ligarEventos();
  atualizarBadge();
  atualizarInfoSessao();
  restaurarSessao();
}

iniciar();
