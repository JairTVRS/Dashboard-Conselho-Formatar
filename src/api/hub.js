import { monthKey } from '../lib/dates.js';

const API_ROOT = '/api/v1';
const PAGE_GUARD = 500;
const RETRY_LIMIT = 3;

const MEETING_FIELDS = 'id,nid,status,customer,participants,startDate,durationInMinutes,updatedAt';
const TASK_FIELDS = 'id,nid,status,customer,responsible,dueDate,durationInMinutes,updatedAt';
const CUSTOMER_FIELDS = 'id,classification';

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
  429: 'Limite de requisições da API excedido. Tente novamente em alguns minutos.',
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

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function request(resource, query) {
  const url = new URL(`${API_ROOT}/${resource}`, window.location.origin);
  Object.entries(query).forEach(([name, raw]) => {
    if (raw !== undefined && raw !== null && raw !== '') url.searchParams.set(name, String(raw));
  });

  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch {
      throw new HubError(0, 'Não foi possível alcançar a API. Verifique a conexão de rede.');
    }

    if (response.status === 429 && attempt < RETRY_LIMIT) {
      await wait(Number(response.headers.get('retry-after') || attempt) * 1000);
      continue;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HubError(response.status, MESSAGES[response.status] || body?.message || `A API respondeu ${response.status}.`);
    }

    return response.json();
  }
}

async function fetchAll(resource, query, onPage) {
  const collected = [];
  let total = null;

  for (let page = 1; page <= PAGE_GUARD; page += 1) {
    const payload = await request(resource, { ...query, page });
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

function activityRecord({ id, status, nid, customer, month, minutes, people, classification }) {
  return {
    id,
    status,
    nid,
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
    classification: classificationOf(customer)
  });
}

export async function testConnection() {
  await request('customers', { fields: 'id', page: 1 });
  return true;
}

/**
 * Sincroniza reuniões e tarefas.
 * `since` (ISO) faz a carga incremental por `updatedAt`; sem ele a janela inteira é recarregada.
 */
export async function syncAll({ since = '', onProgress } = {}) {
  const report = (stage, loaded, total) => onProgress?.({ stage, loaded, total });
  const period = syncWindow();

  report('customers', 0, 0);
  const customerRows = await fetchAll(
    'customers',
    { fields: CUSTOMER_FIELDS, sort: 'nid' },
    (loaded, total) => report('customers', loaded, total)
  );

  const classifications = {};
  customerRows.forEach((row) => {
    const id = identifier(row);
    if (id) classifications[id] = row.classification == null ? '' : String(row.classification).trim();
  });
  const classificationOf = (id) => classifications[id] || '';

  const windowQuery = (field) => ({
    [`${field}[$gte]`]: period.start,
    [`${field}[$lte]`]: period.end,
    ...(since ? { 'updatedAt[$gte]': since } : {})
  });

  report('meetings', 0, 0);
  const meetingRows = await fetchAll(
    'meetings',
    { fields: MEETING_FIELDS, sort: 'nid', ...windowQuery('startDate') },
    (loaded, total) => report('meetings', loaded, total)
  );

  report('tasks', 0, 0);
  const taskRows = await fetchAll(
    'tasks',
    { fields: TASK_FIELDS, sort: 'nid', ...windowQuery('dueDate') },
    (loaded, total) => report('tasks', loaded, total)
  );

  return {
    incremental: Boolean(since),
    syncedAt: new Date().toISOString(),
    period,
    classifications,
    meetings: meetingRows.map((row) => normalizeMeeting(row, classificationOf)).filter((item) => item.month),
    tasks: taskRows.map((row) => normalizeTask(row, classificationOf)).filter((item) => item.month)
  };
}
