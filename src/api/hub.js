import { monthKey, monthLabel } from '../lib/dates.js';

const API_ROOT = '/api/v1';

// A API entrega 100 linhas por página (não há parâmetro de tamanho) e limita a 50
// requisições por minuto. Uma carga completa da janela passa de 780 páginas, então
// esperar a janela reabrir faz parte do fluxo normal — não é situação de erro.
const PAGE_GUARD = 2000;
const RETRY_LIMIT = 6;
const RATE_RESERVE = 2;
const RATE_FALLBACK_WAIT = 60;

const MEETING_FIELDS = 'id,nid,status,customer,participants,meetingType,startDate,durationInMinutes,updatedAt';
const TASK_FIELDS = 'id,nid,status,customer,responsible,team,dueDate,durationInMinutes,updatedAt';
// `tradingName` é o campo "Nome" da tela do cliente; `companyName` é a razão social.
// O relatório de recebimentos traz o Nome na coluna Entidade, então é por ele que os
// dois lados se encontram — a razão social fica só como chave de reserva.
const CUSTOMER_FIELDS = 'id,nid,companyName,tradingName,classification';

/**
 * Coleções pequenas e estáveis que dão nome e vínculo ao que as atividades guardam
 * como id. Somam menos de 100 registros: cabem em quatro páginas.
 *
 * O time não vive na atividade em si — vem do cadastro. A tarefa já traz `team`
 * pronto (conferido: bate com o time da demanda em 100 de 100), e a reunião chega
 * lá pelo tipo, que pode pertencer a mais de um time.
 */
const REFERENCE_SOURCES = [
  { resource: 'teams', fields: 'id,title' },
  { resource: 'user-groups', fields: 'id,title' },
  { resource: 'users', fields: 'id,name,userGroup' },
  { resource: 'meeting-types', fields: 'id,title,teams' }
];

const MEETING_STATUS = {
  unscheduled: 'Previsto',
  sent: 'Enviado',
  scheduled: 'Agendado',
  started: 'Iniciado',
  finished: 'Finalizado',
  canceled_by_customer: 'Cancelado pelo cliente',
  canceled_by_consultant: 'Cancelado pelo consultor',
  canceled_by_scheduling: 'Cancelado pelo agendamento',
  canceled_by_customer_proposal: 'Proposta cancelada pelo cliente'
};

const TASK_STATUS = {
  unscheduled: 'Previsto',
  sent: 'Enviado',
  pending: 'Pendente',
  started: 'Iniciado',
  paused: 'Pausado',
  finished: 'Finalizado',
  canceled: 'Cancelado'
};

const MESSAGES = {
  401: 'Secret key ausente, inválida ou inativa. Configure HUB_API_SECRET_KEY no Cloudflare Pages, ou em .env.local se estiver rodando localmente.',
  403: 'A API recusou a chamada. Se a mensagem citar navegador, a requisição chegou sem passar pelo proxy server-side.',
  429: 'Limite de requisições da API excedido mesmo depois de esperar a janela reabrir. Tente novamente em alguns minutos.',
  503: 'A secret key não está configurada no ambiente de publicação.'
};

export class HubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HubError';
    this.status = status;
  }
}

/** Janela móvel: 1º de janeiro do ano anterior até o fim do dia de hoje. */
export function syncWindow(reference = new Date()) {
  const start = new Date(reference.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
  const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * A carga inicial é fatiada **mês a mês, do mais recente para o mais antigo**.
 *
 * A API deixa passar 50 requisições por minuto e a janela inteira leva uns 16
 * minutos. Fatiar em blocos grandes não resolvia o primeiro acesso: a tela só
 * libera quando o bloco fecha em reuniões *e* tarefas, então um bloco de 6 meses
 * deixava a tela vazia por 4 minutos mesmo com milhares de reuniões já em cache.
 *
 * Um mês são umas 33 páginas, uns 40 segundos: o mês corrente aparece quase
 * imediatamente e a linha do tempo cresce para trás enquanto a pessoa já analisa.
 * Como a fatia é sempre um mês, não há caso especial de virada de ano.
 */
export function syncPhases(reference = new Date()) {
  const period = syncWindow(reference);
  const windowStart = new Date(period.start);

  const phases = [];
  let end = new Date(period.end);
  while (end > windowStart) {
    const monthStart = new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0);
    const start = monthStart < windowStart ? windowStart : monthStart;
    phases.push({ label: monthLabel(monthKey(start)), start: start.toISOString(), end: end.toISOString() });
    end = new Date(start.getTime() - 1);
  }
  return phases;
}

/** Faixa recente recarregada sem filtro de `updatedAt` a cada sincronização. */
export function recentWindow(days = 30, reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - days, 0, 0, 0, 0);
  const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Sobra da janela atual, lida dos headers que o proxy repassa. */
const budget = { remaining: Infinity, resetAt: 0 };

function readBudget(response) {
  const remaining = Number(response.headers.get('ratelimit-remaining'));
  const reset = Number(response.headers.get('ratelimit-reset'));
  if (Number.isFinite(remaining)) budget.remaining = remaining;
  if (Number.isFinite(reset)) budget.resetAt = Date.now() + reset * 1000;
}

/** Segundos até a janela reabrir, com meio segundo de folga para o relógio do servidor. */
function secondsUntilReset(response) {
  const retryAfter = Number(response?.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  const reset = Number(response?.headers.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return reset;
  const pending = Math.ceil((budget.resetAt - Date.now()) / 1000);
  return pending > 0 ? pending : RATE_FALLBACK_WAIT;
}

/**
 * Segura a próxima chamada quando a janela está no fim. Guardar `RATE_RESERVE`
 * requisições evita gastar uma tentativa só para descobrir que estourou.
 */
async function holdForBudget(onWait) {
  if (budget.remaining > RATE_RESERVE) return;
  const ms = Math.max(0, budget.resetAt - Date.now()) + 500;
  if (ms <= 0) return;
  onWait?.(Math.ceil(ms / 1000));
  await wait(ms);
  budget.remaining = Infinity;
}

async function request(resource, query, { onWait } = {}) {
  const url = new URL(`${API_ROOT}/${resource}`, window.location.origin);
  Object.entries(query).forEach(([name, raw]) => {
    if (raw !== undefined && raw !== null && raw !== '') url.searchParams.set(name, String(raw));
  });

  for (let attempt = 1; ; attempt += 1) {
    await holdForBudget(onWait);

    let response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch {
      throw new HubError(0, 'Não foi possível alcançar a API. Verifique a conexão de rede.');
    }

    readBudget(response);

    if (response.status === 429 && attempt < RETRY_LIMIT) {
      const seconds = secondsUntilReset(response);
      onWait?.(seconds);
      await wait(seconds * 1000 + 500);
      budget.remaining = Infinity;
      continue;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HubError(response.status, MESSAGES[response.status] || body?.message || `A API respondeu ${response.status}.`);
    }

    return response.json();
  }
}

async function fetchAll(resource, query, onPage, onWait) {
  const collected = [];
  let total = null;

  for (let page = 1; page <= PAGE_GUARD; page += 1) {
    const payload = await request(resource, { ...query, page }, { onWait });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (total === null) total = Number(payload?.size) || rows.length;
    collected.push(...rows);
    onPage?.(collected.length, total);
    if (!rows.length || collected.length >= total) break;
  }

  return collected;
}

function identifier(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  return String(raw.id || raw._id || '');
}

/** `participants` pode vir como ids, como `{ user }` ou como `{ user: { id } }`. */
function participantIds(participants) {
  if (!Array.isArray(participants)) return [];
  return [...new Set(participants.map((entry) => {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return identifier(entry.user) || identifier(entry);
  }).filter(Boolean))];
}

function activityRecord({ id, status, nid, customer, month, minutes, people, classification, meetingType = '', team = '' }) {
  return {
    id,
    status,
    nid,
    meetingType,
    team,
    client: customer,
    month,
    minutes,
    classification,
    people,
    participant: people[0] || '',
    account: '',
    parcel: '',
    paid: true,
    amount: 0
  };
}

export function normalizeMeeting(row, classificationOf) {
  const customer = identifier(row.customer);
  const people = participantIds(row.participants);
  return activityRecord({
    id: identifier(row),
    status: MEETING_STATUS[row.status] || String(row.status || '').trim(),
    nid: row.nid == null ? '' : String(row.nid),
    customer,
    month: monthKey(row.startDate),
    minutes: Number(row.durationInMinutes) || 0,
    people,
    meetingType: identifier(row.meetingType),
    classification: classificationOf(customer)
  });
}

export function normalizeTask(row, classificationOf) {
  const customer = identifier(row.customer);
  const responsible = identifier(row.responsible);
  return activityRecord({
    id: identifier(row),
    status: TASK_STATUS[row.status] || String(row.status || '').trim(),
    nid: row.nid == null ? '' : String(row.nid),
    customer,
    month: monthKey(row.dueDate),
    minutes: Number(row.durationInMinutes) || 0,
    people: responsible ? [responsible] : [],
    team: identifier(row.team),
    classification: classificationOf(customer)
  });
}

export async function testConnection() {
  await request('customers', { fields: 'id', page: 1 });
  return true;
}

/**
 * `customers` traz classificação, nome e nid. O rótulo da matriz é o **Nome**
 * (`tradingName`) — "FEHEROS", não "CAMPOS FERREIRA COMERCIO ELETRONICO LTDA".
 * A razão social continua guardada porque alguns relatórios importados à mão a
 * usam no lugar do nome.
 */
export async function fetchCustomers({ onProgress } = {}) {
  const onWait = (seconds) => onProgress?.({ stage: 'customers', waitingSeconds: seconds });
  const rows = await fetchAll(
    'customers',
    { fields: CUSTOMER_FIELDS, sort: 'nid' },
    (loaded, total) => onProgress?.({ stage: 'customers', loaded, total }),
    onWait
  );

  const classifications = {};
  const customers = {};
  rows.forEach((row) => {
    const id = identifier(row);
    if (!id) return;
    classifications[id] = row.classification == null ? '' : String(row.classification).trim();
    const companyName = String(row.companyName || '').trim();
    const tradingName = String(row.tradingName || '').trim();
    customers[id] = { nid: row.nid == null ? '' : String(row.nid), name: tradingName || companyName, companyName };
  });
  return { classifications, customers };
}

/** Times, grupos de usuário, usuários e tipos de reunião: o de-para dos ids. */
export async function fetchReference({ onProgress } = {}) {
  const reference = { teams: {}, userGroups: {}, userGroupOf: {}, userNames: {}, meetingTypeTeams: {} };

  for (const source of REFERENCE_SOURCES) {
    const onWait = (seconds) => onProgress?.({ stage: source.resource, waitingSeconds: seconds });
    const rows = await fetchAll(
      source.resource,
      { fields: source.fields },
      (loaded, total) => onProgress?.({ stage: source.resource, loaded, total }),
      onWait
    );

    rows.forEach((row) => {
      const id = identifier(row);
      if (!id) return;
      if (source.resource === 'teams') reference.teams[id] = String(row.title || '').trim();
      if (source.resource === 'user-groups') reference.userGroups[id] = String(row.title || '').trim();
      if (source.resource === 'users') {
        reference.userNames[id] = String(row.name || '').trim();
        const group = identifier(row.userGroup);
        if (group) reference.userGroupOf[id] = group;
      }
      if (source.resource === 'meeting-types') {
        reference.meetingTypeTeams[id] = (Array.isArray(row.teams) ? row.teams : []).map(identifier).filter(Boolean);
      }
    });
  }

  return reference;
}

/**
 * Carrega um intervalo de competência. `since` (ISO) restringe a `updatedAt`, para
 * a atualização de quem já cobriu o período.
 *
 * `onStageDone` entrega cada recurso assim que ele fecha, e serve só para gravar:
 * quem decide o que aparece na tela é a cobertura, que só avança quando o intervalo
 * inteiro termina. Sem isso a tela mostraria reuniões cheias e zero tarefas no
 * intervalo entre os dois.
 */
export async function syncRange({ start, end, since = '', classifications = {}, onProgress, onStageDone } = {}) {
  const classificationOf = (id) => classifications[id] || '';
  let stage = 'meetings';
  const onWait = (seconds) => onProgress?.({ stage, waitingSeconds: seconds });
  const report = (loaded, total) => onProgress?.({ stage, loaded, total });

  const rangeQuery = (field) => ({
    [`${field}[$gte]`]: start,
    [`${field}[$lte]`]: end,
    ...(since ? { 'updatedAt[$gte]': since } : {})
  });

  report(0, 0);
  const meetingRows = await fetchAll(
    'meetings',
    { fields: MEETING_FIELDS, sort: 'nid', ...rangeQuery('startDate') },
    report,
    onWait
  );
  const meetings = meetingRows.map((row) => normalizeMeeting(row, classificationOf)).filter((item) => item.month);
  await onStageDone?.({ meetings });

  stage = 'tasks';
  report(0, 0);
  const taskRows = await fetchAll(
    'tasks',
    { fields: TASK_FIELDS, sort: 'nid', ...rangeQuery('dueDate') },
    report,
    onWait
  );
  const tasks = taskRows.map((row) => normalizeTask(row, classificationOf)).filter((item) => item.month);
  await onStageDone?.({ tasks });

  return { meetings, tasks };
}
