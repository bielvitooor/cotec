import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';

export const BASE_URL = 'https://siga.cotec.go.gov.br';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export class CotecError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CotecError';
    this.status = status;
  }
}

export class CookieJar {
  constructor(initial = {}) {
    this.cookies = new Map(Object.entries(initial));
  }

  absorb(response) {
    const list = response.headers.getSetCookie?.() || [];
    for (const raw of list) {
      const first = raw.split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      const lower = raw.toLowerCase();
      if (/max-age=0(;|$)/.test(lower) || /expires=thu, 01 jan 1970/.test(lower)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  toString() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies);
  }
}

function absoluteUrl(path) {
  return new URL(path, BASE_URL).toString();
}

function formValues(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  return body;
}

export function loadHtml(html) {
  return cheerio.load(html);
}

export function getForm(html, name) {
  const $ = typeof html === 'string' ? loadHtml(html) : html;
  const form = $(`form[name="${name}"]`).first();
  if (!form.length) return null;
  const fields = {};
  form.find('input,select,textarea').each((_, el) => {
    const node = $(el);
    const fieldName = node.attr('name');
    if (!fieldName) return;
    const tag = el.tagName?.toLowerCase();
    const type = (node.attr('type') || '').toLowerCase();

    if (tag === 'select') {
      const selected = node.find('option[selected]').first();
      if (selected.length) fields[fieldName] = selected.attr('value') ?? selected.text().trim();
      else fields[fieldName] = node.find('option').first().attr('value') ?? '';
    } else if (tag === 'textarea') {
      fields[fieldName] = node.text() ?? '';
    } else if (type === 'checkbox' || type === 'radio') {
      if (node.attr('checked') !== undefined) fields[fieldName] = node.attr('value') ?? 'on';
    } else {
      fields[fieldName] = node.attr('value') ?? '';
    }
  });
  return {
    name,
    action: form.attr('action') || '',
    fields,
  };
}

export function getSelectOptions(html, name) {
  const $ = typeof html === 'string' ? loadHtml(html) : html;
  const select = $(`select[name="${name}"]`).first();
  if (!select.length) return [];
  return select
    .find('option')
    .map((_, option) => {
      const node = $(option);
      return {
        value: node.attr('value') ?? node.text().trim(),
        text: node.text().replace(/\s+/g, ' ').trim(),
        selected: node.attr('selected') !== undefined,
      };
    })
    .get();
}

export function firstRealOption(html, name) {
  return getSelectOptions(html, name).find((option) => {
    const value = String(option.value || '').trim();
    return value && value.toLowerCase() !== 'null' && value !== '0';
  });
}

export function selectedOption(html, name) {
  return getSelectOptions(html, name).find((option) => option.selected);
}

function realOptions(options) {
  return (options || []).filter((option) => {
    const value = String(option.value ?? '').trim();
    return value && value.toLowerCase() !== 'null' && value !== '0';
  });
}

function moduleOptions(html) {
  return getSelectOptions(html, 'modulo').filter((option) => {
    const value = String(option.value ?? '').trim();
    if (!value || value.toLowerCase() === 'null') return false;
    return !/^selecione|^escolha|^-+$/i.test(option.text);
  });
}

function pickValue(...values) {
  for (const value of values) {
    const texto = String(value ?? '').trim();
    if (texto && texto.toLowerCase() !== 'null' && texto !== '0') return texto;
  }
  return '';
}

// O ScriptCase devolve a resposta como um literal JavaScript entre aspas,
// com o JSON todo escapado (\" , \/ , \\n ...). Descodificamos o literal como
// o motor JS faria antes de interpretar o JSON.
function decodeJsString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) {
      out += '\\';
      break;
    }
    i += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'v':
        out += '\v';
        break;
      case '0':
        out += '\0';
        break;
      case '\n':
        break;
      case '\r':
        if (raw[i + 1] === '\n') i += 1;
        break;
      case 'x': {
        const hex = raw.slice(i + 1, i + 3);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else {
          out += next;
        }
        break;
      }
      case 'u': {
        if (raw[i + 1] === '{') {
          const fim = raw.indexOf('}', i + 2);
          const hex = fim > 0 ? raw.slice(i + 2, fim) : '';
          if (/^[0-9a-f]+$/i.test(hex)) {
            out += String.fromCodePoint(parseInt(hex, 16));
            i = fim;
          } else {
            out += next;
          }
        } else {
          const hex = raw.slice(i + 1, i + 5);
          if (/^[0-9a-f]{4}$/i.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            out += next;
          }
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

function extractSajaxRes(text) {
  const match = text.match(/var\s+res\s*=\s*/i);
  if (!match) return null;
  const inicio = match.index + match[0].length;
  const primeiro = text[inicio];
  if (primeiro === "'" || primeiro === '"') {
    let raw = '';
    for (let i = inicio + 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 < text.length) {
          raw += ch + text[i + 1];
          i += 1;
        } else {
          raw += ch;
        }
        continue;
      }
      if (ch === primeiro) return { raw, quoted: true };
      raw += ch;
    }
    return null;
  }
  // Respostas antigas podem trazer o objeto direto, sem aspas.
  const fim = text.slice(inicio).search(/;\s*res\s*;/i);
  if (fim < 0) return null;
  return { raw: text.slice(inicio, inicio + fim).trim(), quoted: false };
}

export function parseSajax(text) {
  if (!text || typeof text !== 'string') return null;
  const extraido = extractSajaxRes(text);
  if (!extraido) return null;
  const conteudo = extraido.quoted ? decodeJsString(extraido.raw) : extraido.raw;
  try {
    return JSON.parse(conteudo);
  } catch {
    try {
      return JSON.parse(conteudo.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

export function parseRedirectForm(html) {
  if (!html) return null;
  const action = html.match(/document\.Fredir\.action\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!action) return null;
  const form = getForm(html, 'Fredir');
  return { action, fields: form?.fields || {} };
}

export function parseAutoSubmitForm(html) {
  if (!html) return null;
  // Páginas completas do ScriptCase contêm chamadas como document.F4.submit()
  // dentro de funções, mas não as executam ao carregar. As páginas de transição
  // chamam o submit em um script curto, fora de funções.
  for (const bloco of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const codigo = bloco[1].trim();
    if (!codigo || codigo.length > 4000) continue;
    const scriptMatch = codigo.match(/document\.(F[A-Za-z0-9_]+)\.submit\s*\(\s*\)/);
    const formName = scriptMatch?.[1];
    if (!formName) continue;
    // Fredir costuma ser submetido dentro de $(function(){...}); F4 e afins
    // aparecem dentro de funções normais em páginas completas (falso positivo).
    if (formName !== 'Fredir' && /\bfunction\b/.test(codigo)) continue;
    const form = getForm(html, formName);
    if (!form) continue;
    return { action: form.action || './', fields: form.fields, formName };
  }
  return null;
}

function loginErrorMessage(html) {
  if (!html) return null;
  const match = html.match(/scAjaxFixedErrorSql\("([^"]+)"\)/i);
  if (match) {
    const msg = cheerio.load(`<span>${match[1]}</span>`)('span').text().trim();
    if (msg) return msg;
  }
  if (/Usu[aá]rio ou senha inv[aá]lidos/i.test(html)) return 'Usuário ou senha inválidos.';
  return null;
}

function paginaDeLogin(html) {
  if (!html) return false;
  return (
    /Usuário não autorizado/i.test(html) ||
    (/name=["']pswd["']/i.test(html) && /prof_Login|Módulo do Professor/i.test(html))
  );
}

function salvarDebugPagina(nome, html) {
  try {
    const arquivo = path.join(os.tmpdir(), `cotec-${nome}-debug.html`);
    fs.writeFileSync(arquivo, html, 'utf8');
    console.error(`[COTEC] Resposta inesperada (${nome}) salva em ${arquivo}`);
    return arquivo;
  } catch {
    return null;
  }
}

function optionsFromSajax(text, fieldName) {
  const result = parseSajax(text);
  const field = result?.fldList?.find((item) => item.fldName === fieldName);
  if (!field?.optList) return [];
  const $ = cheerio.load(field.optList);
  return $('option')
    .map((_, option) => {
      const node = $(option);
      return {
        value: node.attr('value') ?? node.text().trim(),
        text: node.text().replace(/\s+/g, ' ').trim(),
        selected: false,
      };
    })
    .get();
}

function dateToISO(date) {
  const match = String(date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeTime(time) {
  const value = String(time || '').trim();
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return value;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lessonIdFromParms(parms) {
  return crypto.createHash('sha1').update(String(parms)).digest('hex').slice(0, 16);
}

export class CotecClient {
  constructor({ cookies = {} } = {}) {
    this.jar = new CookieJar(cookies);
    this.debug = [];
  }

  async request(path, { method = 'GET', body, headers = {}, referer, follow = 0 } = {}) {
    const url = absoluteUrl(path);
    const requestHeaders = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      ...headers,
    };
    const cookie = this.jar.toString();
    if (cookie) requestHeaders.Cookie = cookie;
    if (referer) requestHeaders.Referer = absoluteUrl(referer);
    if (method !== 'GET' && !requestHeaders.Origin) requestHeaders.Origin = BASE_URL;

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(45000),
    });
    this.jar.absorb(response);

    const status = response.status;
    const location = response.headers.get('location');
    this.debug.push({ method, path, status, location: location || null });
    if (this.debug.length > 80) this.debug.shift();

    if ([301, 302, 303, 307, 308].includes(status) && location && follow < 6) {
      const nextMethod =
        status === 303 || ((status === 301 || status === 302) && method !== 'GET') ? 'GET' : method;
      return this.request(new URL(location, url).toString(), {
        method: nextMethod,
        body: nextMethod === 'GET' ? undefined : body,
        headers,
        referer: url,
        follow: follow + 1,
      });
    }

    return response;
  }

  async getText(path, options = {}) {
    const response = await this.request(path, { ...options, method: 'GET' });
    return response.text();
  }

  async postText(path, fields, { referer, headers = {} } = {}) {
    const response = await this.request(path, {
      method: 'POST',
      body: formValues(fields),
      referer,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
    });
    return response.text();
  }

  async ajaxText(path, func, args, { referer } = {}) {
    const body = new URLSearchParams();
    body.set('rs', `ajax_${func}`);
    body.set('rst', '');
    body.set('rsrnd', String(Date.now()));
    for (const arg of args) body.append('rsargs[]', String(arg ?? ''));
    const response = await this.request(path, {
      method: 'POST',
      body,
      referer,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    return response.text();
  }
}

export class CotecSession {
  constructor() {
    this.http = new CotecClient();
    this.profile = null;
    this.diary = null;
    this.lessons = new Map();
    this.diaryFormFields = null;
    this.newLessonParms = null;
    this.newLessonForm = null;
    this.authenticated = false;
    this.lastError = null;
    this.selection = null;
    this.pendingSelection = null;
    this.attendanceCache = new Map();
    this.lastFrequencyHtml = null;
  }

  async followLoginTransitions(html, referer, max = 5) {
    let atual = html;
    let ref = referer;
    let seguiu = false;
    for (let i = 0; i < max; i += 1) {
      const redir = parseRedirectForm(atual);
      const auto = redir ? null : parseAutoSubmitForm(atual);
      const alvo = redir || auto;
      if (!alvo) break;
      const action =
        alvo.action && alvo.action !== './' ? new URL(alvo.action, absoluteUrl(ref)).toString() : ref;
      atual = await this.http.postText(action, alvo.fields || {}, { referer: ref });
      ref = action;
      seguiu = true;
      const erro = loginErrorMessage(atual);
      if (erro) throw new CotecError(erro, 401);
    }
    return { html: atual, seguiu };
  }

  async login(login, password, tipo = '') {
    this.lastError = null;
    const cleanLogin = String(login || '').replace(/\s+/g, '');
    const cleanPassword = String(password || '');
    if (!cleanLogin) throw new CotecError('Informe o CPF ou login.');
    if (!cleanPassword) throw new CotecError('Informe a senha.');

    const loginPage = await this.http.getText('/prof_Login/');
    const form = getForm(loginPage, 'F1');
    if (!form) throw new CotecError('Não foi possível abrir a tela de login do SIGA.');

    // O botão "Login" do SIGA envia o formulário F1 normalmente (não por AJAX),
    // com nmgp_opcao=alterar. Repetimos exatamente esse envio.
    const fields = {
      ...form.fields,
      nmgp_opcao: 'alterar',
      login: cleanLogin,
      pswd: cleanPassword,
    };
    if (fields.bok === undefined) fields.bok = 'OK';
    if (tipo) fields['tipo[]'] = String(tipo);
    else delete fields['tipo[]'];

    let html = await this.http.postText('/prof_Login/', fields, { referer: '/prof_Login/' });
    let erro = loginErrorMessage(html);
    if (erro) throw new CotecError(erro, 401);

    const transicao = await this.followLoginTransitions(html, '/prof_Login/');
    html = transicao.html;
    erro = loginErrorMessage(html);
    if (erro) throw new CotecError(erro, 401);

    if (!transicao.seguiu && /type=["']password["']/i.test(html)) {
      salvarDebugPagina('login', html);
    }

    if (!transicao.seguiu) {
      // Sequência do fluxo real quando o login não devolve um auto-submit.
      await this.http.postText('/prof_define_acesso/', {}, { referer: '/prof_Login/' });
      await this.http.postText('/prof_menu/', {}, { referer: '/prof_define_acesso/' });
    }

    this.authenticated = true;
    try {
      await this.selectTurma();
    } catch (erro) {
      this.authenticated = false;
      throw erro;
    }

    return this.profile;
  }

  async followRedirectForms(html, referer, max = 5) {
    let atual = html;
    let ref = referer;
    for (let i = 0; i < max; i += 1) {
      const redir = parseRedirectForm(atual);
      const auto = redir ? null : parseAutoSubmitForm(atual);
      const alvo = redir || auto;
      if (!alvo) break;
      const action =
        alvo.action && alvo.action !== './' ? new URL(alvo.action, absoluteUrl(ref)).toString() : ref;
      atual = await this.http.postText(action, alvo.fields || {}, { referer: ref });
      ref = action;
      if (/Usuário não autorizado/i.test(atual)) {
        this.authenticated = false;
        throw new CotecError('Sua sessão do SIGA expirou. Entre novamente.', 401);
      }
    }
    return atual;
  }

  async prepararSelecao(opcoes = {}) {
    let html = await this.http.postText(
      '/prof_aulas_sel/',
      {
        nmgp_parms: 'nm_run_menu?#?1?@?nm_apl_menu?#?prof_menu?@?script_case_init?#?1',
        script_case_init: '1',
        nm_apl_menu: 'prof_menu',
      },
      { referer: '/prof_menu/' },
    );

    if (paginaDeLogin(html)) {
      this.authenticated = false;
      throw new CotecError('O SIGA não autorizou a sessão. Verifique o login e tente novamente.', 401);
    }

    const form = getForm(html, 'F1');
    if (!form) {
      throw new CotecError('Não foi possível abrir a seleção de escola/turma/componente.');
    }
    const selectionHtml = html;

    const escolas = realOptions(getSelectOptions(html, 'id_escolas'));
    const escolaNaPagina = selectedOption(html, 'id_escolas')?.value;
    const escolaSolicitada = escolas.some(
      (option) => String(option.value) === String(opcoes.idEscolas || ''),
    )
      ? opcoes.idEscolas
      : '';
    const idEscolas = pickValue(escolaSolicitada, escolaNaPagina, escolas[0]?.value);
    if (!idEscolas) throw new CotecError('Nenhuma escola encontrada para este usuário.');

    let turmas = realOptions(getSelectOptions(html, 'id_turmas'));
    if (!turmas.length || (opcoes.idEscolas && String(opcoes.idEscolas) !== String(escolaNaPagina || ''))) {
      const refresh = await this.http.ajaxText(
        '/prof_aulas_sel/',
        'prof_aulas_sel_refresh_id_escolas',
        [idEscolas, 'id_turmas', '1'],
        { referer: '/prof_aulas_sel/' },
      );
      turmas = realOptions(optionsFromSajax(refresh, 'id_turmas'));
    }
    const turmaNaPagina = turmas.find((option) => option.selected)?.value;
    const turmaSolicitada = turmas.some(
      (option) => String(option.value) === String(opcoes.idTurma || ''),
    )
      ? opcoes.idTurma
      : '';
    const idTurma = pickValue(turmaSolicitada, turmaNaPagina, turmas[0]?.value);
    if (!idTurma) throw new CotecError('Nenhuma turma encontrada para este usuário.');

    let componentes = realOptions(getSelectOptions(html, 'id_turmas_fics'));
    if (
      !componentes.length ||
      (opcoes.idTurma && String(opcoes.idTurma) !== String(turmaNaPagina || ''))
    ) {
      const refresh = await this.http.ajaxText(
        '/prof_aulas_sel/',
        'prof_aulas_sel_refresh_id_turmas',
        [idTurma, 'id_turmas_fics', '1'],
        { referer: '/prof_aulas_sel/' },
      );
      componentes = realOptions(optionsFromSajax(refresh, 'id_turmas_fics'));
    }
    const componenteNaPagina = componentes.find((option) => option.selected)?.value;
    const componenteSolicitado = componentes.some(
      (option) => String(option.value) === String(opcoes.idComponente || ''),
    )
      ? opcoes.idComponente
      : '';
    const idComponente = pickValue(
      componenteSolicitado,
      componenteNaPagina,
      componentes[0]?.value,
    );
    if (!idComponente) throw new CotecError('Nenhum componente curricular encontrado.');

    const selectedFields = {
      ...form.fields,
      id_escolas: idEscolas,
      id_turmas: idTurma,
      id_turmas_fics: idComponente,
      nmgp_opcao: 'alterar',
    };
    await this.http.postText('/prof_aulas_sel/', selectedFields, { referer: '/prof_aulas_sel/' });

    const parms = `prof17_id_turmas_fics*scin${idComponente}*scoutNM_btn_insert*scinS*scoutNM_btn_update*scinS*scoutNM_btn_delete*scinS*scoutNM_btn_navega*scinN*scout`;
    html = await this.http.postText(
      '/prof_aulas_sel2/',
      {
        nmgp_parms: parms,
        nmgp_url_saida: '/prof_aulas_sel/',
        script_case_init: '1',
      },
      { referer: '/prof_aulas_sel/' },
    );

    if (/Usuário não autorizado/i.test(html)) {
      this.authenticated = false;
      throw new CotecError('O SIGA não autorizou a seleção da turma.', 401);
    }

    const moduleForm = getForm(html, 'F1');
    if (!moduleForm) throw new CotecError('Não foi possível abrir a seleção de módulo.');

    const professores = realOptions(getSelectOptions(html, 'id_turmas_fics_prof'));
    const modulos = moduleOptions(html);
    const professor =
      professores.find((option) => String(option.value) === String(opcoes.professorId || '')) ||
      professores.find((option) => option.selected) ||
      professores[0];
    if (!professor?.value) throw new CotecError('Nenhum vínculo de professor encontrado.');
    const modulo =
      modulos.find((option) => String(option.value) === String(opcoes.modulo || '')) ||
      modulos.find((option) => /DI[AÁ]RIO\s*-\s*AULAS/i.test(option.text)) ||
      modulos[0];
    if (!modulo?.value) throw new CotecError('O módulo de diário não está disponível.');

    const escola = escolas.find((option) => String(option.value) === String(idEscolas));
    const turma = turmas.find((option) => String(option.value) === String(idTurma));
    const componente = componentes.find(
      (option) => String(option.value) === String(idComponente),
    );

    this.pendingSelection = {
      key: [idEscolas, idTurma, idComponente].map(String).join('|'),
      idEscolas: String(idEscolas),
      idTurma: String(idTurma),
      idComponente: String(idComponente),
      escola: escola?.text || primeiroNomeEscola(selectionHtml) || '',
      turma: turma?.text || '',
      componente: componente?.text || '',
      professorId: String(professor.value),
      professor: professor.text,
      modulo: String(modulo.value),
      moduloTexto: modulo.text,
      moduleFormFields: { ...moduleForm.fields },
      opcoes: { escolas, turmas, componentes, professores, modulos },
      selectionHtml,
    };
    return this.pendingSelection;
  }

  async aplicarSelecao(opcoes = {}) {
    const atual = this.pendingSelection || this.selection;
    const ids = {
      idEscolas: pickValue(opcoes.idEscolas, atual?.idEscolas),
      idTurma: pickValue(opcoes.idTurma, atual?.idTurma),
      idComponente: pickValue(opcoes.idComponente, atual?.idComponente),
    };
    const chave = [ids.idEscolas, ids.idTurma, ids.idComponente].map(String).join('|');
    let pendente = this.pendingSelection;
    if (!pendente || pendente.key !== chave) {
      pendente = await this.prepararSelecao({ ...opcoes, ...ids });
    }

    const professor =
      pendente.opcoes.professores.find(
        (option) =>
          String(option.value) === String(pickValue(opcoes.professorId, pendente.professorId)),
      ) ||
      pendente.opcoes.professores.find((option) => option.selected) ||
      pendente.opcoes.professores[0];
    if (!professor?.value) throw new CotecError('Nenhum vínculo de professor encontrado.');

    const modulo =
      pendente.opcoes.modulos.find(
        (option) => String(option.value) === String(pickValue(opcoes.modulo, pendente.modulo)),
      ) ||
      pendente.opcoes.modulos.find((option) => /DI[AÁ]RIO\s*-\s*AULAS/i.test(option.text)) ||
      pendente.opcoes.modulos[0];
    if (!modulo?.value) throw new CotecError('O módulo de diário não está disponível.');

    const moduleFields = {
      ...pendente.moduleFormFields,
      id_turmas_fics_prof: professor.value,
      modulo: modulo.value,
      id_matriculas: '',
      nmgp_opcao: 'alterar',
    };
    const moduleResponse = await this.http.postText('/prof_aulas_sel2/', moduleFields, {
      referer: '/prof_aulas_sel2/',
    });

    const diaryHtml = await this.followRedirectForms(moduleResponse, '/prof_aulas_sel2/');

    this.selection = {
      ...pendente,
      professorId: String(professor.value),
      professor: professor.text,
      modulo: String(modulo.value),
      moduloTexto: modulo.text,
    };
    this.pendingSelection = null;

    this.profile = {
      escolaTurma: `${pendente.escola || ''} - ${pendente.turma || ''}`.replace(/^ - /, ''),
      escola: pendente.escola || null,
      turma: pendente.turma || null,
      componente: pendente.componente || null,
      professor: professor.text,
      idEscolas: pendente.idEscolas,
      idTurma: pendente.idTurma,
      idComponente: pendente.idComponente,
      modulo: String(modulo.value),
      moduloTexto: modulo.text,
      professorId: String(professor.value),
    };

    // O formulário F3 pertence ao diário anterior. Se o redirecionamento do
    // novo módulo não abrir o diário, a recuperação deve usar a seleção nova.
    this.diaryFormFields = null;
    this.lastFrequencyHtml = null;
    const diario = await this.getDiary(diaryHtml);
    this.profile = {
      ...this.profile,
      modulo: String(modulo.value),
      moduloTexto: modulo.text,
      idEscolas: pendente.idEscolas,
      idTurma: pendente.idTurma,
      idComponente: pendente.idComponente,
      professorId: String(professor.value),
    };
    return diario;
  }

  async selectTurma(opcoes = {}) {
    return this.aplicarSelecao(opcoes);
  }

  selectionSummary(source = this.selection) {
    if (!source?.opcoes) return null;
    const mapear = (opcoes) =>
      (opcoes || []).map((option) => ({ valor: String(option.value), texto: option.text }));
    return {
      atual: {
        escola: source.escola || null,
        turma: source.turma || null,
        componente: source.componente || null,
        professor: source.professor || null,
        modulo: source.moduloTexto || null,
        moduloId: source.modulo ? String(source.modulo) : null,
        ids: {
          escola: source.idEscolas ? String(source.idEscolas) : null,
          turma: source.idTurma ? String(source.idTurma) : null,
          componente: source.idComponente ? String(source.idComponente) : null,
          professor: source.professorId ? String(source.professorId) : null,
          modulo: source.modulo ? String(source.modulo) : null,
        },
      },
      opcoes: {
        escolas: mapear(source.opcoes.escolas),
        turmas: mapear(source.opcoes.turmas),
        componentes: mapear(source.opcoes.componentes),
        professores: mapear(source.opcoes.professores),
        modulos: mapear(source.opcoes.modulos),
      },
    };
  }

  async reabrirDiario() {
    // 1) Reenvia o formulário F3 do diário. Funciona quando o ScriptCase só
    // perdeu o contexto da grade (por exemplo, depois de abrir uma frequência).
    if (this.diaryFormFields) {
      try {
        const resposta = await this.http.postText(
          '/prof_diario_grid/',
          {
            ...this.diaryFormFields,
            nmgp_opcao: 'grid',
            nm_grid_submit: '1',
          },
          { referer: '/prof_diario_grid/' },
        );
        const html = await this.followRedirectForms(resposta, '/prof_diario_grid/');
        if (paginaDeLogin(html)) {
          this.authenticated = false;
          throw new CotecError('Sua sessão do SIGA expirou. Entre novamente.', 401);
        }
        const parsed = parseDiary(html);
        if (parsed.lessons.length || parsed.formFields) return html;
      } catch (erro) {
        if (erro.status === 401) throw erro;
        console.error('[COTEC] POST do diário falhou:', erro.message);
      }
    }

    // 2) Reabre a seleção de turma/módulo, que termina no diário. É o caminho
    // mais confiável quando o contexto da sessão foi perdido por completo.
    if (this.selection) {
      const atual = this.selection;
      const pendente = await this.prepararSelecao({
        idEscolas: atual.idEscolas,
        idTurma: atual.idTurma,
        idComponente: atual.idComponente,
        professorId: atual.professorId,
        modulo: atual.modulo,
      });
      const moduleFields = {
        ...pendente.moduleFormFields,
        id_turmas_fics_prof: pendente.professorId,
        modulo: pendente.modulo,
        id_matriculas: '',
        nmgp_opcao: 'alterar',
      };
      const moduleResponse = await this.http.postText('/prof_aulas_sel2/', moduleFields, {
        referer: '/prof_aulas_sel2/',
      });
      const diaryHtml = await this.followRedirectForms(moduleResponse, '/prof_aulas_sel2/');
      if (paginaDeLogin(diaryHtml)) {
        this.authenticated = false;
        throw new CotecError('Sua sessão do SIGA expirou. Entre novamente.', 401);
      }
      const parsed = parseDiary(diaryHtml);
      if (parsed.lessons.length || parsed.formFields) {
        this.selection = { ...pendente };
        this.pendingSelection = null;
        this.profile = {
          ...(this.profile || {}),
          escolaTurma: `${pendente.escola || ''} - ${pendente.turma || ''}`.replace(/^ - /, ''),
          escola: pendente.escola || null,
          turma: pendente.turma || null,
          componente: pendente.componente || null,
          professor: pendente.professor || null,
          idEscolas: pendente.idEscolas,
          idTurma: pendente.idTurma,
          idComponente: pendente.idComponente,
          modulo: pendente.modulo,
          moduloTexto: pendente.moduloTexto,
          professorId: pendente.professorId,
        };
        return diaryHtml;
      }
    }

    return null;
  }

  async getDiary(htmlInicial = null) {
    let html = htmlInicial || '';
    let parsed = { lessons: [], formFields: null };
    const vazio = () => !parsed.lessons.length && !parsed.formFields;
    const conferirLogin = (conteudo) => {
      if (!paginaDeLogin(conteudo)) return;
      this.authenticated = false;
      throw new CotecError(
        htmlInicial
          ? 'O SIGA autenticou, mas não abriu o diário. Tente novamente.'
          : 'Sua sessão do SIGA expirou. Entre novamente.',
        401,
      );
    };

    if (html) {
      conferirLogin(html);
      parsed = parseDiary(html);
      if (vazio()) {
        // Se a página veio de um redirecionamento intermediário, tenta a via direta.
        html = await this.http.getText('/prof_diario_grid/');
        conferirLogin(html);
        parsed = parseDiary(html);
      }
    } else {
      html = await this.http.getText('/prof_diario_grid/');
      conferirLogin(html);
      parsed = parseDiary(html);
    }

    if (vazio()) {
      // Abrir a grade de frequência muda o contexto do ScriptCase. Nesse caso o
      // GET direto pode devolver "Dados inválidos" mesmo com a sessão válida.
      // Tenta reabrir o diário antes de encerrar a sessão do usuário.
      try {
        const reaberto = await this.reabrirDiario();
        if (reaberto) {
          html = reaberto;
          conferirLogin(html);
          parsed = parseDiary(html);
        }
      } catch (erro) {
        if (erro.status === 401) throw erro;
        console.error('[COTEC] Não foi possível reabrir o diário:', erro.message);
      }
    }

    if (vazio()) {
      salvarDebugPagina('diario', html);
      if (/Dados inválidos/i.test(html)) {
        throw new CotecError(
          'O SIGA não recarregou o diário. Tente novamente em instantes.',
          502,
        );
      }
      throw new CotecError('Não foi possível ler o diário. Verifique a turma selecionada.');
    }
    this.diary = parsed;
    this.diaryFormFields = parsed.formFields;
    this.newLessonParms = parsed.newLessonParms;
    this.lessons = new Map(parsed.lessons.map((lesson) => [lesson.id, lesson]));
    this.attendanceCache.clear();
    const parsedProfile = Object.fromEntries(
      Object.entries(parsed.profile || {}).filter(([, value]) => value),
    );
    this.profile = {
      ...(this.profile || {}),
      ...parsedProfile,
    };
    return this.diary;
  }

  async getFrequency(lessonId) {
    const lesson = await this.resolveLesson(lessonId);
    const html = await this.openFrequency(lesson);
    this.lastFrequencyHtml = html;
    const parsed = parseFrequency(html);
    parsed.lesson = lesson;
    parsed.scriptCaseInit = parsed.scriptCaseInit || this.diaryFormFields?.script_case_init || '';
    return parsed;
  }

  async fecharFrequencia(html = this.lastFrequencyHtml) {
    if (!html) return false;
    const form = getForm(html, 'F5');
    if (!form) return false;
    try {
      const resposta = await this.http.postText(
        '/prof_diario_frequencia_grid/prof_diario_frequencia_grid_fim.php',
        form.fields,
        { referer: '/prof_diario_frequencia_grid/' },
      );
      await this.followRedirectForms(resposta, '/prof_diario_frequencia_grid/');
      return true;
    } catch (erro) {
      // A volta é só uma limpeza de contexto; nunca deve derrubar a sessão.
      console.error('[COTEC] Não foi possível voltar da grade de frequência:', erro.message);
      return false;
    }
  }

  async getAttendanceStatus(lessonIds = []) {
    const ids = [...new Set((lessonIds || []).map(String).filter(Boolean))].slice(0, 12);
    const resultado = [];
    this.lastFrequencyHtml = null;
    try {
      for (const id of ids) {
        const cache = this.attendanceCache.get(id);
        if (cache) {
          resultado.push({ id, ...cache });
          continue;
        }
        try {
          const frequencia = await this.getFrequency(id);
          const statuses = frequencia.students.map((aluno) =>
            String(aluno.status || '').toUpperCase(),
          );
          const presentes = statuses.filter((status) => /PRESENTE/.test(status)).length;
          const ausentes = statuses.filter((status) => /AUSENTE|FALTA/.test(status)).length;
          const info = {
            lancada: presentes + ausentes > 0,
            presentes,
            ausentes,
            total: frequencia.students.length,
          };
          this.attendanceCache.set(id, info);
          resultado.push({ id, ...info });
        } catch (erro) {
          if (erro.status === 401) throw erro;
          resultado.push({ id, lancada: null, erro: erro.message });
        }
      }
      return resultado;
    } finally {
      // Deixa o ScriptCase de volta na grade do diário. Sem isso, um clique em
      // "Atualizar diário" pode receber "Dados inválidos" e parecer sessão expirada.
      const ultima = this.lastFrequencyHtml;
      this.lastFrequencyHtml = null;
      if (ultima) await this.fecharFrequencia(ultima);
    }
  }

  async resolveLesson(lessonId) {
    if (!lessonId) throw new CotecError('Selecione uma aula.');
    let lesson = this.lessons.get(String(lessonId));
    if (!lesson) {
      await this.getDiary();
      lesson = this.lessons.get(String(lessonId));
    }
    if (!lesson) throw new CotecError('Aula não encontrada. Atualize o diário.', 404);
    return lesson;
  }

  async openFrequency(lesson) {
    const baseFields = this.diaryFormFields || {};
    const fields = {
      ...baseFields,
      nmgp_opcao: 'grid',
      nmgp_url_saida: lesson.urlSaida || '/prof_diario_grid/',
      nmgp_parms: lesson.parms,
      SC_lig_apl_orig: 'prof_diario_grid',
      nm_grid_submit: '1',
    };
    const html = await this.http.postText('/prof_diario_frequencia_grid/', fields, {
      referer: '/prof_diario_grid/',
    });
    if (paginaDeLogin(html)) {
      this.authenticated = false;
      throw new CotecError('Sua sessão do SIGA expirou. Entre novamente.', 401);
    }
    return html;
  }

  async applyFrequency(lessonId, presentIds = [], absentIds = []) {
    const lesson = await this.resolveLesson(lessonId);
    const wantedPresent = prepararSelecaoAlunos(presentIds);
    const chavesPresentes = new Set(wantedPresent.map(chaveSelecaoAluno));
    const wantedAbsent = prepararSelecaoAlunos(absentIds).filter(
      (selecao) => !chavesPresentes.has(chaveSelecaoAluno(selecao)),
    );

    if (!wantedPresent.length && !wantedAbsent.length) {
      return {
        ok: true,
        lesson,
        present: 0,
        absent: 0,
        warnings: ['Nenhum aluno selecionado.'],
        verified: true,
      };
    }

    let html = await this.openFrequency(lesson);
    let parsed = parseFrequency(html);
    const indice = indexarAlunos(parsed.students);

    const warnings = [];
    const rowsPresent = [];
    const rowsAbsent = [];
    const selectedPresentNames = [];
    const selectedAbsentNames = [];

    for (const selecao of wantedPresent) {
      const student = indice.buscar(selecao);
      if (!student) {
        warnings.push(`Aluno presente não encontrado nesta aula: ${selecao.rotulo}`);
        continue;
      }
      if (!rowsPresent.includes(student.rowValue)) {
        rowsPresent.push(student.rowValue);
        selectedPresentNames.push(student.name);
      }
    }
    for (const selecao of wantedAbsent) {
      const student = indice.buscar(selecao);
      if (!student) {
        warnings.push(`Aluno ausente não encontrado nesta aula: ${selecao.rotulo}`);
        continue;
      }
      if (!rowsPresent.includes(student.rowValue) && !rowsAbsent.includes(student.rowValue)) {
        rowsAbsent.push(student.rowValue);
        selectedAbsentNames.push(student.name);
      }
    }

    if (rowsPresent.length) {
      html = await this.submitFrequencyAction(lesson, html, parsed, 'presenca', rowsPresent);
    }
    if (rowsAbsent.length) {
      // Reabre a grade para garantir que a segunda ação parta de uma grade limpa.
      await sleep(150);
      html = await this.openFrequency(lesson);
      parsed = parseFrequency(html);
      html = await this.submitFrequencyAction(lesson, html, parsed, 'falta', rowsAbsent);
    }

    // Reabre a grade para conferir o resultado real no SIGA.
    await sleep(200);
    const verifyHtml = await this.openFrequency(lesson);
    const verifiedParsed = parseFrequency(verifyHtml);
    const indiceVerificacao = indexarAlunos(verifiedParsed.students);

    const mismatches = [];
    for (const selecao of wantedPresent) {
      const student = indiceVerificacao.buscar(selecao);
      if (!student) continue;
      if (!/PRESENTE/i.test(student.status)) {
        mismatches.push(`${student.name}: esperado PRESENTE, retornou "${student.status || 'sem status'}"`);
      }
    }
    for (const selecao of wantedAbsent) {
      const student = indiceVerificacao.buscar(selecao);
      if (!student) continue;
      if (!/AUSENTE|FALTA/i.test(student.status)) {
        mismatches.push(`${student.name}: esperado AUSENTE, retornou "${student.status || 'sem status'}"`);
      }
    }

    const statusVerificados = verifiedParsed.students.map((aluno) =>
      String(aluno.status || '').toUpperCase(),
    );
    const presentesVerificados = statusVerificados.filter((status) => /PRESENTE/.test(status)).length;
    const ausentesVerificados = statusVerificados.filter((status) => /AUSENTE|FALTA/.test(status)).length;
    this.attendanceCache.set(String(lessonId), {
      lancada: presentesVerificados + ausentesVerificados > 0,
      presentes: presentesVerificados,
      ausentes: ausentesVerificados,
      total: verifiedParsed.students.length,
    });

    // Limpa o contexto da frequência para o diário continuar atualizável.
    await this.fecharFrequencia(verifyHtml);
    this.lastFrequencyHtml = null;

    const ok = mismatches.length === 0 && warnings.length === 0;
    let message;
    if (mismatches.length) {
      message = 'O SIGA respondeu, mas a conferência encontrou divergências.';
    } else if (warnings.length) {
      const aplicados = rowsPresent.length + rowsAbsent.length;
      message = aplicados
        ? `Chamada parcial: ${aplicados} aluno(s) registrado(s) e ${warnings.length} não encontrado(s) nesta aula.`
        : 'Nenhum aluno da seleção foi encontrado nesta aula. Nada foi registrado.';
    } else {
      message = `Chamada registrada: ${rowsPresent.length} presente(s) e ${rowsAbsent.length} ausente(s).`;
    }

    return {
      ok,
      lesson,
      present: rowsPresent.length,
      absent: rowsAbsent.length,
      presentNames: selectedPresentNames,
      absentNames: selectedAbsentNames,
      warnings,
      verified: mismatches.length === 0,
      mismatches,
      message,
    };
  }

  async submitFrequencyAction(lesson, html, parsed, action, rows) {
    const btnForm = parsed.buttonForm || getForm(html, 'FBtn_Run')?.fields || {};
    const fields = {
      ...btnForm,
      nmgp_opcao: 'formphp',
      rec: '',
      nm_call_php: action === 'presenca' ? 'btn_registrar_presenca' : 'btn_registrar_falta',
      nm_run_opt_sel: `${rows.join(';')};undefined`,
      script_case_init: parsed.scriptCaseInit || btnForm.script_case_init || '',
    };

    const body = formValues(fields);
    for (const row of rows) body.append('NM_ck_grid[]', row);

    const response = await this.http.request('/prof_diario_frequencia_grid/', {
      method: 'POST',
      body,
      referer: '/prof_diario_frequencia_grid/',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    let responseHtml = await response.text();

    const auto = parseAutoSubmitForm(responseHtml);
    if (auto) {
      const autoFields = { ...auto.fields };
      const autoPath = auto.action && auto.action !== './'
        ? new URL(auto.action, `${BASE_URL}/prof_diario_frequencia_grid/`).toString()
        : '/prof_diario_frequencia_grid/';
      responseHtml = await this.http.postText(autoPath, autoFields, {
        referer: '/prof_diario_frequencia_grid/',
      });
    }

    return responseHtml;
  }

  async getNewLessonForm({ renovar = false } = {}) {
    if (renovar || !this.newLessonParms || !this.diaryFormFields) {
      // Reabrir o diário antes de montar o formulário evita enviar CSRF/contexto
      // velhos, especialmente depois de abrir e fechar a grade de frequência.
      this.newLessonParms = null;
      this.newLessonForm = null;
      await this.getDiary();
    }
    if (!this.newLessonParms) {
      throw new CotecError('O botão de nova aula não está disponível no diário.');
    }

    const fields = {
      ...this.diaryFormFields,
      nmgp_opcao: '',
      nmgp_url_saida: '/prof_diario_grid/',
      nmgp_parms: this.newLessonParms,
      SC_lig_apl_orig: 'prof_diario_grid',
      nm_grid_submit: '1',
    };
    const html = await this.http.postText('/prof_diario_novo_form/index.php', fields, {
      referer: '/prof_diario_grid/',
    });
    if (/Usuário não autorizado/i.test(html)) {
      this.authenticated = false;
      throw new CotecError('Sua sessão do SIGA expirou. Entre novamente.', 401);
    }
    const form = getForm(html, 'F1');
    if (!form) throw new CotecError('Não foi possível abrir o formulário de nova aula.');

    this.newLessonForm = {
      url: '/prof_diario_novo_form/index.php',
      fields: { ...form.fields },
      parms: this.newLessonParms,
    };

    const qtdeOptions = getSelectOptions(html, 'qtde');
    return {
      data_aula: form.fields.data_aula || '',
      hora_inicial: form.fields.hora_inicial || '',
      qtde: form.fields.qtde || '1',
      maxQtde: Math.max(1, qtdeOptions.length),
      conteudo: Array.from({ length: 8 }, (_, index) => ({
        conteudo: form.fields[`conteudo${index + 1}`] || '',
        observacoes: form.fields[`observacoes${index + 1}`] || '',
      })),
      objetivo: form.fields.objetivo || '',
      metodologia: form.fields.metodologia || '',
      recursos_didaticos: form.fields.recursos_didaticos || '',
      bibliografia: form.fields.bibliografia || '',
      avaliacao: form.fields.avaliacao || '',
    };
  }

  async createLesson(data) {
    // Sempre reabre o formulário antes de salvar: o SIGA troca o contexto e o
    // token CSRF ao navegar entre diário, frequência e nova aula.
    await this.getNewLessonForm({ renovar: true });
    const aulasAntes = new Set((this.diary?.lessons || []).map((aula) => aula.id));
    const form = this.newLessonForm;
    const qtde = Math.max(1, Math.min(8, Number.parseInt(data.qtde || '1', 10) || 1));
    const dataAula = String(data.data_aula || '').trim();
    const horaInicial = normalizeTime(data.hora_inicial);
    if (!dataAula) throw new CotecError('Informe a data da aula.');
    if (!horaInicial) throw new CotecError('Informe o horário inicial.');

    const contents = data.conteudo || [];
    // Ordem do SIGA: data, hora, qtde, depois conteúdo/observação de cada aula (1..8).
    const conteudos = Array.from({ length: 8 }, (_, index) => contents[index]?.conteudo || '');
    const observacoes = Array.from({ length: 8 }, (_, index) => contents[index]?.observacoes || '');
    const ordered = [dataAula, horaInicial, String(qtde)];
    for (let index = 0; index < 8; index += 1) {
      ordered.push(conteudos[index]);
      ordered.push(observacoes[index]);
    }
    ordered.push(
      data.objetivo || '',
      data.metodologia || '',
      data.recursos_didaticos || '',
      data.bibliografia || '',
      data.avaliacao || '',
      form.fields.nm_form_submit || '1',
      '/prof_diario_grid/',
      'alterar',
      form.fields.nmgp_ancora || '',
      form.fields.nmgp_num_form || '',
      '',
      form.fields.script_case_init || '',
      form.fields.csrf_token || '',
    );

    const responseText = await this.http.ajaxText(
      '/prof_diario_novo_form/index.php',
      'prof_diario_novo_form_submit_form',
      ordered,
      { referer: '/prof_diario_novo_form/index.php' },
    );
    const result = parseSajax(responseText);
    if (!result) {
      const arquivo = salvarDebugPagina('nova-aula', responseText);
      console.error(
        `[COTEC] Resposta inesperada ao salvar aula${arquivo ? ` (salva em ${arquivo})` : ''}:`,
        String(responseText || '').slice(0, 1200),
      );
      if (paginaDeLogin(responseText)) {
        this.authenticated = false;
        throw new CotecError('Sua sessão do SIGA expirou. Entre novamente.', 401);
      }

      // Mesmo sem uma resposta SAJAX válida, a aula pode ter sido criada.
      // Recarrega o diário e confere pelo par data/horário antes de acusar erro.
      try {
        this.newLessonForm = null;
        this.newLessonParms = null;
        await this.getDiary();
        const criada = (this.diary?.lessons || []).find(
          (aula) =>
            !aulasAntes.has(aula.id) &&
            aula.date === dataAula &&
            String(aula.time).slice(0, 5) === horaInicial.slice(0, 5),
        );
        if (criada) {
          return {
            ok: true,
            message: `Aula de ${dataAula} criada com sucesso.`,
            diary: this.diary,
          };
        }
      } catch {
        // Mantém o erro original; a próxima atualização do diário confirma.
      }

      throw new CotecError(
        'O SIGA retornou uma resposta inesperada ao salvar a aula. Tente novamente; se persistir, o diagnóstico foi salvo para análise.',
        502,
      );
    }
    if (result.result === 'ERROR') {
      const message =
        result.errList?.map((item) => item.msgText).filter(Boolean).join(' ') ||
        'Não foi possível salvar a aula.';
      throw new CotecError(message);
    }

    if (result.htmOutput) {
      const redirect = parseRedirectForm(result.htmOutput);
      if (redirect) {
        await this.http.postText(redirect.action, redirect.fields, {
          referer: '/prof_diario_novo_form/index.php',
        });
      }
    }
    if (result.redirInfo?.action) {
      const fields = {
        nmgp_parms: result.redirInfo.nmgp_parms || '',
        nmgp_url_saida: result.redirInfo.nmgp_url_saida || '',
        script_case_init: result.redirInfo.script_case_init || '',
      };
      await this.http.postText(result.redirInfo.action, fields, {
        referer: '/prof_diario_novo_form/index.php',
      });
    }

    this.newLessonForm = null;
    this.newLessonParms = null;
    this.diary = null;
    try {
      await this.getDiary();
    } catch {
      // A aula já foi criada; se o diário não recarregar agora, o painel atualiza depois.
    }
    return {
      ok: true,
      message: `Aula de ${dataAula} criada com sucesso.`,
      diary: this.diary,
    };
  }

  getDebug() {
    return {
      authenticated: this.authenticated,
      profile: this.profile,
      requests: this.http.debug.slice(-20),
    };
  }
}

function primeiroNomeEscola(html) {
  const $ = cheerio.load(html);
  const label = $('.scFormLabelOddFormat, .scFormLabelEvenFormat')
    .filter((_, el) => /escola/i.test($(el).text()))
    .first();
  if (!label.length) return null;
  const container = label.closest('td');
  return compactText(container.find('input,select').first().val() || '') || null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function somenteDigitos(value) {
  return String(value || '').replace(/\D/g, '');
}

// O SIGA usa um ID diferente para o mesmo aluno em cada aula (é o ID da
// matrícula/frequência daquela aula). Por isso a chamada em lote não pode
// reutilizar o ID carregado na primeira aula: CPF e nome são as chaves estáveis.
function normalizarSelecaoAluno(item) {
  if (item && typeof item === 'object') {
    return {
      id: item.id != null ? String(item.id) : '',
      cpf: somenteDigitos(item.cpf),
      nome: normalizeName(item.nome ?? item.name),
      rotulo: String(item.nome ?? item.name ?? item.cpf ?? item.id ?? 'aluno sem identificação'),
      identidadeEstavel: true,
    };
  }
  const texto = String(item ?? '').trim();
  return {
    id: texto,
    cpf: '',
    nome: normalizeName(texto),
    rotulo: texto,
    identidadeEstavel: false,
  };
}

function chaveSelecaoAluno(selecao) {
  if (selecao.cpf) return `cpf:${selecao.cpf}`;
  if (selecao.nome) return `nome:${selecao.nome}`;
  return `id:${selecao.id}`;
}

function prepararSelecaoAlunos(lista = []) {
  const itens = [];
  const vistos = new Set();
  for (const item of Array.isArray(lista) ? lista : []) {
    const selecao = normalizarSelecaoAluno(item);
    if (!selecao.id && !selecao.cpf && !selecao.nome) continue;
    const chave = chaveSelecaoAluno(selecao);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(selecao);
  }
  return itens;
}

function indexarAlunos(students = []) {
  const porId = new Map();
  const porCpf = new Map();
  const porNome = new Map();
  for (const student of students) {
    if (student.id) porId.set(String(student.id), student);
    const cpf = somenteDigitos(student.cpf);
    if (cpf) porCpf.set(cpf, student);
    const nome = normalizeName(student.name);
    if (!nome) continue;
    if (!porNome.has(nome)) porNome.set(nome, student);
    else if (porNome.get(nome) !== student) porNome.set(nome, null);
  }

  return {
    buscar(selecao) {
      if (selecao.identidadeEstavel) {
        // Prioriza CPF/nome: o ID recebido pode ser de outra aula.
        if (selecao.cpf && porCpf.has(selecao.cpf)) return porCpf.get(selecao.cpf);
        if (selecao.nome && porNome.has(selecao.nome)) return porNome.get(selecao.nome) || null;
        if (selecao.id && porId.has(selecao.id)) return porId.get(selecao.id);
        return null;
      }
      // Compatibilidade com chamadas antigas, que enviavam apenas o ID.
      if (selecao.id && porId.has(selecao.id)) return porId.get(selecao.id);
      if (selecao.nome && porNome.has(selecao.nome)) return porNome.get(selecao.nome) || null;
      return null;
    },
  };
}

export function parseDiary(html) {
  const $ = cheerio.load(html);
  const headerTexts = $('.scGridHeaderFont')
    .map((_, el) => compactText($(el).text()))
    .get()
    .filter(Boolean);

  const lessons = [];
  $('a[id^="id_sc_field_frequencia_"]').each((_, link) => {
    const node = $(link);
    const href = node.attr('href') || '';
    const match = href.match(
      /nm_gp_submit5\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']*)'/,
    );
    if (!match) return;
    const [, action, urlSaida, parms, target, opc] = match;
    const row = node.closest('tr');
    const date = compactText(row.find('[id^="id_sc_field_data_aula_fmt_"]').first().text());
    const time = compactText(row.find('[id^="id_sc_field_hora_inicial_"]').first().text());
    const professor = compactText(row.find('[id^="id_sc_field_professor_"]').first().text());
    const codigo = compactText(row.find('[id^="id_sc_field_id_"]').first().text());
    const duracao = compactText(row.find('[id^="id_sc_field_duracao_"]').first().text());
    const id = lessonIdFromParms(parms);
    lessons.push({
      id,
      codigo: codigo || null,
      duracao: duracao || null,
      parms,
      action,
      urlSaida,
      target,
      opc,
      date,
      dateISO: dateToISO(date),
      time: String(time).slice(0, 5),
      professor: professor || null,
      status: null,
    });
  });

  const newLessonMatch = ($('a#sc_novo_top').attr('onclick') || '').match(
    /nm_gp_submit5\('\/prof_diario_novo_form\/index\.php',\s*'([^']+)',\s*'([^']+)'/,
  );

  const title =
    headerTexts.find((text) => /-\s*[A-Z0-9]+-/i.test(text)) ||
    headerTexts.find((text) => / - /.test(text)) ||
    null;
  const componente =
    headerTexts.find((text) => /\(40HR\)|COMPUTADOR|DIÁRIO|DIARIO/i.test(text) && text !== title) ||
    null;
  const titleParts = (title || '').split(' - ');
  const escola = titleParts.length > 1 ? titleParts.slice(0, -1).join(' - ') : null;
  const turma = titleParts.length > 1 ? titleParts[titleParts.length - 1] : title || null;

  const form = getForm(html, 'F3');
  return {
    title: compactText($('title').text()),
    headerTexts,
    profile: {
      escolaTurma: title,
      escola,
      turma,
      componente,
      professor: lessons[0]?.professor || null,
    },
    lessons,
    newLessonParms: newLessonMatch?.[2] || null,
    formFields: form?.fields || null,
    newLessonUrl: newLessonMatch?.[1] || null,
  };
}

export function parseFrequency(html) {
  const $ = cheerio.load(html);
  const bodyText = compactText($('body').text());
  const dateMatch = bodyText.match(/FREQU[ÊE]NCIA NA AULA DO DIA\s+(\d{2}\/\d{2}\/\d{4})/i);
  const date = dateMatch?.[1] || null;
  const students = [];

  $('input.sc-ui-check-run').each((_, input) => {
    const node = $(input);
    const row = node.closest('tr');
    const id = compactText(row.find('[id^="id_sc_field_id_"]').first().text());
    const name = compactText(row.find('[id^="id_sc_field_nome_"]').first().text());
    const cpf = compactText(row.find('[id^="id_sc_field_cpff_"]').first().text());
    const matricula = compactText(row.find('[id^="id_sc_field_data_matricula_"]').first().text());
    const status = compactText(row.find('[id^="id_sc_field_ausente_presente_f_"]').first().text());
    const justificativa = compactText(row.find('[id^="id_sc_field_aus_just_status_f_"]').first().text());
    const rowValue = node.attr('value') || '';
    if (!name && !id) return;
    students.push({
      id: id || rowValue,
      rowValue,
      name,
      cpf,
      matricula,
      status,
      justificativa,
      key: id || rowValue || normalizeName(name),
    });
  });

  const buttonForm = getForm(html, 'FBtn_Run')?.fields || {};
  const f4 = getForm(html, 'F4')?.fields || {};
  const scriptCaseInit =
    buttonForm.script_case_init || f4.script_case_init || getForm(html, 'F3')?.fields?.script_case_init || '';

  return {
    date,
    dateISO: dateToISO(date),
    students,
    buttonForm,
    scriptCaseInit,
    title: compactText($('title').text()),
  };
}
