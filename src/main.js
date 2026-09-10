import * as XLSX from 'xlsx';
import './style.css';
import { monthKey, monthLabel, shortMonth, dateTimeLabel } from './lib/dates.js';
import { syncAll, syncWindow, testConnection, HubError } from './api/hub.js';
import { initTheme } from './theme.js';

const STORAGE_KEY = 'formatar-dashboard-operational-data-v1';
const DATABASE_NAME = 'formatar-dashboard-storage';
const DATABASE_VERSION = 1;
const DATABASE_STORE = 'dashboard-state';

const state = {
  meetings: [],
  tasks: [],
  payments: [],
  classifications: {},
  fileMeta: {
    payments: { name: '', latest: '', loaded: false }
  },
  sync: { lastSync: '', running: false, error: '', message: '' },
  classification: 'all',
  segment: 'all',
  month: 'all',
  activeTab: 'volume',
  excludedDates: new Set()
};

const meetingStatuses = new Set(['Previsto', 'Agendado', 'Enviado', 'Iniciado', 'Finalizado']);
const taskStatuses = new Set(['Previsto', 'Enviado', 'Pendente', 'Iniciado', 'Pausado', 'Finalizado']);

const GEAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="currentColor"/><path d="m19.4 13.5.1-1.5-.1-1.5 1.7-1.3a.8.8 0 0 0 .2-1l-1.6-2.8a.8.8 0 0 0-1-.3l-2 .8a7.6 7.6 0 0 0-2.6-1.5l-.3-2.1a.8.8 0 0 0-.8-.7h-3.2a.8.8 0 0 0-.8.7l-.3 2.1a7.6 7.6 0 0 0-2.6 1.5l-2-.8a.8.8 0 0 0-1 .3L2.7 8.2a.8.8 0 0 0 .2 1l1.7 1.3-.1 1.5.1 1.5-1.7 1.3a.8.8 0 0 0-.2 1l1.6 2.8a.8.8 0 0 0 1 .3l2-.8a7.6 7.6 0 0 0 2.6 1.5l.3 2.1a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7l.3-2.1a7.6 7.6 0 0 0 2.6-1.5l2 .8a.8.8 0 0 0 1-.3l1.6-2.8a.8.8 0 0 0-.2-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const SUN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z"/></svg>';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div class="hero-brand">
        <img id="brand-logo" class="brand-logo" alt="Formatar — Gestão e Governança" width="316" height="104" />
        <div>
          <p class="eyebrow">CONSELHO FORMATAR / GESTÃO</p>
          <h1>Indicadores Operacionais</h1>
          <p class="hero-copy">Linha do tempo mensal de reuniões, tarefas, capacidade, qualidade e custos pagos.</p>
        </div>
      </div>
      <div class="hero-actions">
        <div class="hero-badge"><span class="pulse"></span><span id="data-status">Aguardando dados</span></div>
        <div class="action-buttons">
          <button id="theme-toggle" class="icon-action" type="button" aria-label="Alternar tema">${SUN_ICON}${MOON_ICON}</button>
          <button id="settings-toggle" class="icon-action" type="button" aria-label="Configurações de dados e integrações" title="Configurações de dados e integrações">${GEAR_ICON}</button>
        </div>
      </div>
    </header>

    <section class="filters">
      <div class="filter-block"><label for="segment">Visão</label><select id="segment"><option value="all">Todas</option><option value="internal">Internos</option><option value="external">Externos</option></select></div>
      <div class="filter-block"><label for="classification">Classificação do cliente</label><select id="classification"><option value="all">Todas as classificações</option></select></div>
      <div class="filter-block"><label for="month">Competência</label><select id="month"><option value="all">Todos os meses</option></select></div>
    </section>

    <nav class="indicator-tabs" aria-label="Grupos de indicadores">
      <button class="indicator-tab is-active" data-tab="volume" type="button">Volume</button>
      <button class="indicator-tab" data-tab="productivity" type="button">Produtividade</button>
      <button class="indicator-tab" data-tab="cost" type="button">Custo</button>
      <button class="indicator-tab" data-tab="quality" type="button">Qualidade</button>
    </nav>

    <section id="indicator-panel"></section>
    <section class="detail-section"><details><summary>Detalhes de status cancelados e registros desconsiderados</summary><div id="status-details" class="detail-content">Nenhum dado carregado.</div></details></section>
  </main>

  <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
  <aside class="settings-drawer" id="settings-drawer" hidden>
    <div class="drawer-head">
      <div><p class="eyebrow">CONFIGURAÇÕES</p><h2>Dados e integrações</h2></div>
      <button id="close-settings" class="icon-button" type="button" aria-label="Fechar">×</button>
    </div>

    <nav class="drawer-tabs" aria-label="Seções de configuração">
      <button class="drawer-tab is-active" data-drawer-tab="data" type="button">Dados</button>
      <button class="drawer-tab" data-drawer-tab="connection" type="button">Conexão</button>
      <button class="drawer-tab" data-drawer-tab="calendar" type="button">Calendário</button>
    </nav>

    <section class="drawer-panel is-active" data-drawer-panel="data">
      <h3>Sincronização com o Hub</h3>
      <p class="muted">Reuniões e tarefas vêm da API do Hub. A janela considerada vai de <strong id="window-label">—</strong>.</p>
      <div class="sync-box">
        <div class="sync-row"><span>Última sincronização</span><strong id="sync-when">nunca</strong></div>
        <div class="sync-row"><span>Reuniões em cache</span><strong id="sync-meetings">0</strong></div>
        <div class="sync-row"><span>Tarefas em cache</span><strong id="sync-tasks">0</strong></div>
        <div class="sync-progress" id="sync-progress" hidden><span></span></div>
        <p class="sync-message" id="sync-message"></p>
        <div class="sync-actions">
          <button id="sync-now" class="button" type="button">Sincronizar agora</button>
          <button id="sync-full" class="button secondary" type="button">Recarregar janela completa</button>
        </div>
      </div>

      <h3>Pagamentos</h3>
      <p class="muted">A API do Hub não expõe pagamentos, então este relatório continua sendo importado manualmente.</p>
      <label class="upload-card" id="upload-card-payments">
        <span class="upload-state" aria-label="Aguardando upload">○</span>
        <strong>Pagamentos</strong>
        <small>CSV ou XLSX</small>
        <span class="upload-latest">Ainda não importado</span>
        <input id="payment-file" type="file" accept=".xlsx,.xls,.csv" />
      </label>
      <div class="upload-feedback" id="upload-feedback">Carregue o relatório de pagamentos para preencher a aba de Custo.</div>

      <div class="danger-zone">
        <button id="clear-cache" class="button ghost" type="button">Limpar cache local</button>
        <span class="muted">Apaga os dados guardados no navegador e força uma recarga completa.</span>
      </div>
    </section>

    <section class="drawer-panel" data-drawer-panel="connection">
      <h3>Conexão com a API</h3>
      <p class="muted">As chamadas passam por uma função do Cloudflare Pages que injeta a secret key no servidor. A chave nunca é enviada ao navegador nem fica no código publicado.</p>
      <div class="api-note">
        <strong>Como configurar</strong>
        <span>Em <em>Cloudflare Pages → Configurações → Variáveis e segredos</em>, crie um segredo chamado <code>HUB_API_SECRET_KEY</code> (o nome <code>Authorization</code> também é aceito) com o valor da secret key e faça um novo deploy.</span>
      </div>
      <div class="sync-actions">
        <button id="test-connection" class="button" type="button">Testar conexão</button>
      </div>
      <p class="sync-message" id="connection-message">Conexão não verificada nesta sessão.</p>
    </section>

    <section class="drawer-panel" data-drawer-panel="calendar">
      <h3>Calendário de competência</h3>
      <p class="muted">A jornada considera 9 horas de segunda a quinta e 8 horas na sexta, já descontado o almoço. Cadastre datas adicionais individualmente.</p>
      <div class="date-row"><input id="excluded-date" type="date" /><button id="add-date" class="button" type="button">Adicionar data</button></div>
      <div id="excluded-dates" class="date-list"></div>
    </section>
  </aside>
`;

const $ = (selector) => document.querySelector(selector);

initTheme();

$('#payment-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.payments = mergeRows('payments', normalizePaymentRows(await readFile(file)));
    const latest = [...new Set(state.payments.map((item) => item.month).filter(Boolean))].sort().at(-1) || '';
    state.fileMeta.payments = { name: file.name, latest, loaded: true };
    persistState();
    $('#upload-feedback').textContent = `${file.name} carregado: ${state.payments.length.toLocaleString('pt-BR')} registros válidos para análise.`;
    render();
  } catch (error) {
    $('#upload-feedback').textContent = `Não foi possível ler ${file.name}: ${error.message}`;
  }
});

$('#segment').addEventListener('change', (event) => { state.segment = event.target.value; render(); });
$('#classification').addEventListener('change', (event) => { state.classification = event.target.value; render(); });
$('#month').addEventListener('change', (event) => { state.month = event.target.value; render(); });
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { state.activeTab = button.dataset.tab; render(); }));

$('#settings-toggle').addEventListener('click', () => toggleDrawer(true));
$('#close-settings').addEventListener('click', () => toggleDrawer(false));
$('#drawer-backdrop').addEventListener('click', () => toggleDrawer(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') toggleDrawer(false); });

document.querySelectorAll('[data-drawer-tab]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-drawer-tab]').forEach((tab) => tab.classList.toggle('is-active', tab === button));
  document.querySelectorAll('[data-drawer-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.drawerPanel === button.dataset.drawerTab));
}));

$('#sync-now').addEventListener('click', () => runSync({ incremental: true }));
$('#sync-full').addEventListener('click', () => runSync({ incremental: false }));
$('#clear-cache').addEventListener('click', clearCache);
$('#test-connection').addEventListener('click', runConnectionTest);

$('#add-date').addEventListener('click', () => {
  const date = $('#excluded-date').value;
  if (date) state.excludedDates.add(date);
  $('#excluded-date').value = '';
  persistState();
  renderExcludedDates();
  render();
});

function toggleDrawer(open) {
  $('#settings-drawer').hidden = !open;
  $('#drawer-backdrop').hidden = !open;
  document.body.classList.toggle('drawer-open', open);
}

function readFile(file) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  });
}

function value(row, names) {
  const key = Object.keys(row).find((candidate) => names.some((name) => candidate.trim().toLowerCase() === name.toLowerCase()));
  return key ? row[key] : '';
}

function normalizeNumber(raw) {
  if (typeof raw === 'number') return raw;
  const text = String(raw ?? '').replace(/R\$\s?/g, '').trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized) || 0;
}

function normalizePaymentRows(rows) {
  return rows.map((row) => {
    const status = String(value(row, ['Status'])).trim();
    return {
      status,
      nid: String(value(row, ['NID'])).replace(/^#/, '').trim(),
      client: String(value(row, ['Cliente', 'Entidade'])).trim(),
      month: monthKey(value(row, ['Vencimento'])),
      minutes: 0,
      classification: String(value(row, ['Classificação', 'classification'])).trim(),
      account: String(value(row, ['Planos de contas'])).trim(),
      parcel: String(value(row, ['Parcela'])).trim(),
      paid: status.toLowerCase() === 'pago',
      amount: normalizeNumber(value(row, ['Valor pago'])),
      people: [],
      participant: String(value(row, ['Responsável'])).trim()
    };
  }).filter((item) => item.month);
}

function recordKey(kind, item) {
  if (kind === 'payments') return [item.nid, item.parcel, item.month, item.account, item.amount].join('|');
  return item.id || item.nid || [item.client, item.month, item.status, item.participant].join('|');
}

function mergeRows(kind, incoming) {
  const merged = new Map(state[kind].map((item) => [recordKey(kind, item), item]));
  incoming.forEach((item) => merged.set(recordKey(kind, item), item));
  return [...merged.values()];
}

async function runSync({ incremental }) {
  if (state.sync.running) return;
  state.sync.running = true;
  state.sync.error = '';
  renderSyncStatus();

  const since = incremental ? state.sync.lastSync : '';
  const progress = $('#sync-progress');
  progress.hidden = false;

  const labels = { customers: 'clientes', meetings: 'reuniões', tasks: 'tarefas' };

  try {
    const result = await syncAll({
      since,
      onProgress: ({ stage, loaded, total }) => {
        const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        progress.firstElementChild.style.width = `${percent}%`;
        state.sync.message = `Carregando ${labels[stage]}: ${loaded.toLocaleString('pt-BR')}${total ? ` de ${total.toLocaleString('pt-BR')}` : ''}`;
        renderSyncStatus();
      }
    });

    state.classifications = result.classifications;
    state.meetings = applyClassifications(mergeRows('meetings', result.meetings));
    state.tasks = applyClassifications(mergeRows('tasks', result.tasks));
    state.sync.lastSync = result.syncedAt;
    state.sync.message = `${result.incremental ? 'Sincronização incremental' : 'Recarga completa'} concluída: ${result.meetings.length.toLocaleString('pt-BR')} reuniões e ${result.tasks.length.toLocaleString('pt-BR')} tarefas recebidas.`;
    await persistState();
    render();
  } catch (error) {
    state.sync.error = error instanceof HubError ? error.message : `Falha na sincronização: ${error.message}`;
    state.sync.message = '';
  } finally {
    state.sync.running = false;
    progress.hidden = true;
    progress.firstElementChild.style.width = '0%';
    renderSyncStatus();
    renderDataStatus();
  }
}

/** Reaplica a classificação vinda de `customers` a todos os registros em cache. */
function applyClassifications(items) {
  return items.map((item) => ({ ...item, classification: state.classifications[item.client] ?? item.classification ?? '' }));
}

async function runConnectionTest() {
  const message = $('#connection-message');
  message.textContent = 'Testando…';
  message.className = 'sync-message';
  try {
    await testConnection();
    message.textContent = 'Conexão estabelecida: a API respondeu normalmente.';
    message.className = 'sync-message is-ok';
  } catch (error) {
    message.textContent = error instanceof HubError ? error.message : `Falha no teste: ${error.message}`;
    message.className = 'sync-message is-error';
  }
}

async function clearCache() {
  state.meetings = [];
  state.tasks = [];
  state.payments = [];
  state.classifications = {};
  state.fileMeta.payments = { name: '', latest: '', loaded: false };
  state.sync = { lastSync: '', running: false, error: '', message: 'Cache local apagado.' };
  await persistState();
  render();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(DATABASE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function serializableState() {
  return {
    meetings: state.meetings,
    tasks: state.tasks,
    payments: state.payments,
    classifications: state.classifications,
    fileMeta: state.fileMeta,
    excludedDates: [...state.excludedDates],
    lastSync: state.sync.lastSync
  };
}

async function persistState() {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).put(serializableState(), 'current');
    transaction.oncomplete = () => database.close();
  } catch {
    // IndexedDB é o armazenamento durável; a UI continua utilizável se o navegador bloquear.
  }
}

async function restoreState() {
  try {
    const database = await openDatabase();
    const saved = await new Promise((resolve, reject) => {
      const request = database.transaction(DATABASE_STORE, 'readonly').objectStore(DATABASE_STORE).get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const legacy = saved ? null : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const source = saved || legacy;
    if (!source) return;
    state.meetings = source.meetings || [];
    state.tasks = source.tasks || [];
    state.payments = source.payments || [];
    state.classifications = source.classifications || {};
    state.fileMeta = { ...state.fileMeta, ...(source.fileMeta || {}) };
    state.excludedDates = new Set(source.excludedDates || []);
    state.sync.lastSync = source.lastSync || '';
    if (legacy) {
      await persistState();
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    state.meetings = [];
    state.tasks = [];
    state.payments = [];
  }
}

function dateIsExcluded(date) {
  const day = date.getDay();
  return day === 0 || day === 6 || state.excludedDates.has(date.toISOString().slice(0, 10));
}

function workingHours(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  let hours = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthNumber - 1, day);
    if (!dateIsExcluded(date)) hours += date.getDay() === 5 ? 8 : 9;
  }
  return hours;
}

function workingDays(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  let days = 0;
  for (let day = 1; day <= lastDay; day += 1) if (!dateIsExcluded(new Date(year, monthNumber - 1, day))) days += 1;
  return days;
}

function unique(items, key) { return new Set(items.map((item) => item[key]).filter(Boolean)).size; }

/** Reuniões trazem vários participantes por registro, então a contagem percorre os arrays. */
function uniquePeople(items) {
  const people = new Set();
  items.forEach((item) => {
    const list = item.people?.length ? item.people : (item.participant ? [item.participant] : []);
    list.forEach((person) => people.add(person));
  });
  return people.size;
}

function formatNumber(number, digits = 0) { return Number(number || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function formatCurrency(valueToFormat) { return Number(valueToFormat || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function latestLabel(month) { return month ? `Dados mais recentes: ${monthLabel(month)}` : 'Sem competência válida'; }

function availableMonths() {
  const months = [...new Set([...state.meetings, ...state.tasks, ...state.payments].map((item) => item.month).filter(Boolean))].sort();
  if (months.length < 2) return months;
  const result = [];
  const [startYear, startMonth] = months[0].split('-').map(Number);
  const [endYear, endMonth] = months[months.length - 1].split('-').map(Number);
  for (let cursor = new Date(startYear, startMonth - 1, 1); cursor <= new Date(endYear, endMonth - 1, 1); cursor.setMonth(cursor.getMonth() + 1)) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

function filteredData(kind) {
  const source = state[kind].filter((item) => item.month && (kind !== 'payments' ? item.status === 'Finalizado' : item.paid));
  return source.filter((item) => (kind === 'payments' || state.classification === 'all' || item.classification === state.classification) && (state.month === 'all' || item.month === state.month));
}

function distinctActivities(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.nid || `${item.client}-${item.month}-${item.status}-${item.participant}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function metricsFor(month) {
  const meetings = filteredData('meetings').filter((item) => item.month === month);
  const tasks = filteredData('tasks').filter((item) => item.month === month);
  const payments = filteredData('payments').filter((item) => item.month === month);
  const selectedMeetings = state.segment === 'internal' ? [] : distinctActivities(meetings);
  const selectedTasks = state.segment === 'external' ? [] : distinctActivities(tasks);
  const activities = [...selectedMeetings, ...selectedTasks];
  const capacity = workingHours(month);
  const minutes = activities.reduce((sum, item) => sum + item.minutes, 0);
  const costByPlan = payments.reduce((plans, item) => { const plan = item.account || 'Sem plano de contas'; plans[plan] = (plans[plan] || 0) + item.amount; return plans; }, {});
  return { meetings: selectedMeetings, tasks: selectedTasks, payments, activities, capacity, minutes, clients: unique(activities, 'client'), people: uniquePeople(activities), cost: payments.reduce((sum, item) => sum + item.amount, 0), costByPlan };
}

function render() {
  const months = availableMonths();
  renderClassificationOptions();

  const monthSelect = $('#month');
  const selected = state.month;
  monthSelect.innerHTML = `<option value="all">Todos os meses</option>${months.map((month) => `<option value="${month}">${monthLabel(month)}</option>`).join('')}`;
  monthSelect.value = months.includes(selected) || selected === 'all' ? selected : 'all';
  state.month = monthSelect.value;

  renderIndicatorPanel(months);
  renderDetails();
  renderExcludedDates();
  renderUploadStatus();
  renderSyncStatus();
  renderDataStatus(months);
}

function renderDataStatus(months = availableMonths()) {
  const badge = $('#data-status');
  if (state.sync.running) { badge.textContent = 'Sincronizando…'; return; }
  if (state.sync.error) { badge.textContent = 'Falha na sincronização'; return; }
  badge.textContent = months.length ? `${months.length} competências carregadas` : 'Aguardando dados';
}

function renderClassificationOptions() {
  const select = $('#classification');
  const values = [...new Set([...state.meetings, ...state.tasks].map((item) => item.classification).filter(Boolean))]
    .sort((first, second) => String(first).localeCompare(String(second), 'pt-BR', { numeric: true }));
  const selected = state.classification;
  select.innerHTML = `<option value="all">Todas as classificações</option>${values.map((item) => `<option value="${item}">${item}</option>`).join('')}`;
  select.value = values.includes(selected) ? selected : 'all';
  state.classification = select.value;
  select.disabled = values.length === 0;
}

function renderSyncStatus() {
  const period = syncWindow();
  $('#window-label').textContent = `${monthLabel(monthKey(period.start))} até ${monthLabel(monthKey(period.end))}`;
  $('#sync-when').textContent = state.sync.lastSync ? dateTimeLabel(state.sync.lastSync) : 'nunca';
  $('#sync-meetings').textContent = formatNumber(state.meetings.length);
  $('#sync-tasks').textContent = formatNumber(state.tasks.length);
  $('#sync-now').disabled = state.sync.running;
  $('#sync-full').disabled = state.sync.running;

  const message = $('#sync-message');
  message.textContent = state.sync.error || state.sync.message;
  message.className = `sync-message${state.sync.error ? ' is-error' : state.sync.message ? ' is-ok' : ''}`;
}

function tabButtonState() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === state.activeTab));
}

function renderIndicatorPanel(months) {
  tabButtonState();
  const panel = $('#indicator-panel');
  panel.innerHTML = `<section class="table-section"><div class="section-heading"><div><p class="eyebrow">LINHA DO TEMPO / ${state.activeTab.toUpperCase()}</p><h2>${{ volume: 'Volume', productivity: 'Produtividade', cost: 'Custo', quality: 'Qualidade' }[state.activeTab]}</h2></div><span id="timeline-range" class="muted">Sem competência carregada</span></div><div id="indicator-table" class="indicator-table-wrap"></div></section>`;
  renderIndicatorTable(months);
}

function renderIndicatorTable(months) {
  const table = $('#indicator-table');
  if (!months.length) {
    table.className = 'indicator-table-wrap empty-state';
    table.textContent = 'Sincronize com o Hub na engrenagem para visualizar a linha do tempo.';
    return;
  }
  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  $('#timeline-range').textContent = `${monthLabel(visible[0])} até ${monthLabel(visible[visible.length - 1])}`;
  const rows = timelineRows(state.activeTab, visible);
  const comparison = comparisonPeriod(visible);
  table.innerHTML = `<table class="indicator-table"><thead><tr><th>Indicador</th><th>${comparison.previousLabel}</th><th>${comparison.currentLabel}</th><th>Variação</th>${visible.map((month) => `<th>${monthLabel(month)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => { const previous = accumulated(row, comparison.previousMonths, comparison.endMonth); const current = accumulated(row, comparison.currentMonths, comparison.endMonth); const variation = previous ? (current / previous - 1) * 100 : null; return `<tr class="${row.section ? 'table-section-row' : ''}"><th>${row.label}</th><td>${row.format(previous)}</td><td>${row.format(current)}</td><td class="variation-cell ${variationClass(variation)}">${variation === null ? '-' : `${formatNumber(variation, 2)}%`}</td>${visible.map((month) => `<td>${row.format(row.value(month))}</td>`).join('')}</tr>`; }).join('')}</tbody></table>`;
  requestAnimationFrame(() => { table.scrollLeft = table.scrollWidth; });
}

function comparisonPeriod(months) {
  const endMonth = Number(months[months.length - 1].split('-')[1]);
  const currentYear = Number(months[months.length - 1].split('-')[0]);
  const previousYear = currentYear - 1;
  const range = (year) => months.filter((month) => Number(month.split('-')[0]) === year && Number(month.split('-')[1]) <= endMonth);
  return { endMonth, currentMonths: range(currentYear), previousMonths: range(previousYear), previousLabel: `jan/${String(previousYear).slice(-2)} a ${shortMonth(endMonth)}/${String(previousYear).slice(-2)}`, currentLabel: `jan/${String(currentYear).slice(-2)} a ${shortMonth(endMonth)}/${String(currentYear).slice(-2)}` };
}

function accumulated(row, months, endMonth) {
  if (!months.length) return 0;
  const values = months.filter((month) => Number(month.split('-')[1]) <= endMonth).map((month) => row.value(month));
  if (row.aggregate === 'average') return values.length ? values.reduce((sum, valueToAdd) => sum + valueToAdd, 0) / values.length : 0;
  return values.reduce((sum, valueToAdd) => sum + valueToAdd, 0);
}

function variationClass(variation) {
  if (variation === null) return '';
  if (variation > 5) return 'variation-good';
  if (variation < -5) return 'variation-bad';
  return 'variation-neutral';
}

function timelineRows(tab, months) {
  const metric = (month) => metricsFor(month);
  const totalActivities = (month) => metric(month).activities.length;
  const average = (month, selector) => { const items = selector(metric(month)); return items.length ? items.reduce((sum, item) => sum + item.minutes, 0) / items.length / 60 : 0; };
  const number = (valueToFormat) => formatNumber(valueToFormat);
  const hours = (valueToFormat) => `${formatNumber(valueToFormat, 1)} h`;
  const percent = (valueToFormat) => `${formatNumber(valueToFormat, 1)}%`;
  if (tab === 'volume') return [
    { label: 'Atividades finalizadas, em qtde', value: totalActivities, format: number },
    { label: 'Reuniões realizadas, em qtde', value: (month) => metric(month).meetings.length, format: number },
    { label: 'Tarefas realizadas, em qtde', value: (month) => metric(month).tasks.length, format: number },
    { label: 'Atividades realizadas, em horas', value: (month) => metric(month).minutes / 60, format: hours },
    { label: 'Clientes atendidos, em qtde', value: (month) => metric(month).clients, format: number },
    { label: 'Responsáveis e participantes distintos', value: (month) => metric(month).people, format: number },
    { label: 'Dias úteis do mês, em qtde', value: (month) => workingDays(month), format: number },
    { label: 'Tempo de trabalho disponível, em HH/mês', value: (month) => metric(month).capacity, format: hours }
  ];
  if (tab === 'productivity') return [
    { label: 'Tempo de trabalho disponível, em HH/mês', value: (month) => metric(month).capacity, format: hours },
    { label: 'Horas apontadas, em HH', value: (month) => metric(month).minutes / 60, format: hours },
    { label: 'Ocupação do tempo disponível, em %', value: (month) => metric(month).capacity ? metric(month).minutes / 60 / metric(month).capacity * 100 : 0, format: percent },
    { label: 'Tempo médio das reuniões, em horas', value: (month) => average(month, (current) => current.meetings), format: hours },
    { label: 'Tempo médio das tarefas, em horas', value: (month) => average(month, (current) => current.tasks), format: hours },
    { label: 'Atividades, em qtde/cliente/mês', value: (month) => metric(month).clients ? totalActivities(month) / metric(month).clients : 0, format: (valueToFormat) => formatNumber(valueToFormat, 1) },
    { label: 'Atividades, em qtde/dia', value: (month) => workingDays(month) ? totalActivities(month) / workingDays(month) : 0, format: (valueToFormat) => formatNumber(valueToFormat, 1) },
    { label: 'Atividades, em qtde/dia/pessoa', value: (month) => workingDays(month) && metric(month).people ? totalActivities(month) / workingDays(month) / metric(month).people : 0, format: (valueToFormat) => formatNumber(valueToFormat, 1) }
  ];
  if (tab === 'cost') return [
    { label: 'Custos totais pagos, em R$', value: (month) => metric(month).cost, format: formatCurrency },
    { label: 'Custo por hora de atividade, em R$', value: (month) => metric(month).minutes ? metric(month).cost / (metric(month).minutes / 60) : 0, format: formatCurrency },
    { label: 'Custo por atividade finalizada, em R$', value: (month) => totalActivities(month) ? metric(month).cost / totalActivities(month) : 0, format: formatCurrency },
    ...[...new Set(months.flatMap((month) => Object.keys(metric(month).costByPlan)))].sort().map((plan) => ({ label: `Plano · ${plan}`, value: (month) => metric(month).costByPlan[plan] || 0, format: formatCurrency }))
  ];
  const statusRows = [...state.meetings, ...state.tasks].map((item) => item.status).filter(Boolean).filter((status, index, statuses) => statuses.indexOf(status) === index).sort();
  return [
    { label: 'Atividades finalizadas, em qtde', value: totalActivities, format: number },
    { label: 'Atividades canceladas, em qtde', value: (month) => [...state.meetings, ...state.tasks].filter((item) => item.month === month && item.status.toLowerCase().includes('cancel')).length, format: number },
    { label: 'Taxa de conclusão, em %', value: (month) => { const all = [...state.meetings, ...state.tasks].filter((item) => item.month === month); return all.length ? all.filter((item) => item.status === 'Finalizado').length / all.length * 100 : 0; }, format: percent },
    ...statusRows.map((status) => ({ label: `Status · ${status}`, value: (month) => [...state.meetings, ...state.tasks].filter((item) => item.month === month && item.status === status).length, format: number }))
  ];
}

function renderUploadStatus() {
  const meta = state.fileMeta.payments;
  const card = $('#upload-card-payments');
  if (!card) return;
  card.classList.toggle('is-loaded', meta.loaded);
  const stateIcon = card.querySelector('.upload-state');
  const latest = card.querySelector('.upload-latest');
  stateIcon.textContent = meta.loaded ? '✓' : '○';
  stateIcon.setAttribute('aria-label', meta.loaded ? 'Upload concluído' : 'Aguardando upload');
  latest.textContent = meta.loaded ? latestLabel(meta.latest) : 'Ainda não importado';
  latest.title = meta.name || '';
}

function renderDetails() {
  const cancellations = [...state.meetings, ...state.tasks].filter((item) => item.status.toLowerCase().includes('cancel')).reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
  const ignored = [...state.meetings, ...state.tasks].filter((item) => item.status && item.status !== 'Finalizado' && !meetingStatuses.has(item.status) && !taskStatuses.has(item.status)).length;
  const entries = Object.entries(cancellations);
  $('#status-details').innerHTML = entries.length ? `${entries.map(([status, count]) => `<span class="status-row"><b>${status}</b><strong>${formatNumber(count)}</strong></span>`).join('')}<span class="status-row"><b>Registros com status não mapeado</b><strong>${formatNumber(ignored)}</strong></span>` : '<p class="muted">Nenhum cancelamento carregado.</p>';
}

function renderExcludedDates() {
  $('#excluded-dates').innerHTML = [...state.excludedDates].sort().map((date) => `<span class="date-chip">${date}<button type="button" data-date="${date}" aria-label="Remover data">×</button></span>`).join('') || '<span class="muted">Nenhuma data adicional.</span>';
  $('#excluded-dates').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { state.excludedDates.delete(button.dataset.date); persistState(); renderExcludedDates(); render(); }));
}

restoreState().then(() => {
  render();
  runSync({ incremental: Boolean(state.sync.lastSync) });
});
