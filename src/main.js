import * as XLSX from 'xlsx';
import './style.css';

const apiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  secretKey: import.meta.env.VITE_API_SECRET_KEY || ''
};
const STORAGE_KEY = 'formatar-dashboard-operational-data-v1';
const DATABASE_NAME = 'formatar-dashboard-storage';
const DATABASE_VERSION = 1;
const DATABASE_STORE = 'dashboard-state';

const state = {
  meetings: [],
  tasks: [],
  payments: [],
  fileMeta: {
    meetings: { name: '', latest: '', loaded: false },
    tasks: { name: '', latest: '', loaded: false },
    payments: { name: '', latest: '', loaded: false }
  },
  classification: 'all',
  segment: 'all',
  month: 'all',
  activeTab: 'volume',
  excludedDates: new Set(),
  apiConfigured: Boolean(apiConfig.baseUrl && apiConfig.secretKey)
};

const meetingStatuses = new Set(['Previsto', 'Agendado', 'Enviado', 'Iniciado', 'Finalizado']);
const taskStatuses = new Set(['Previsto', 'Enviado', 'Pendente', 'Iniciado', 'Pausado', 'Finalizado']);
const cancelledMeetingStatuses = new Set(['Cancelado pelo cliente', 'Cancelado pelo consultor', 'Cancelado pelo agendamento', 'Proposta cancelada pelo cliente']);

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">CONSELHO FORMATAR / GESTÃO</p>
        <h1>Indicadores Operacionais</h1>
        <p class="hero-copy">Linha do tempo mensal de reuniões, tarefas, capacidade, qualidade e custos pagos.</p>
      </div>
      <div class="hero-badge"><span class="pulse"></span><span id="data-status">Aguardando dados</span></div>
    </header>

    <section class="control-panel">
      <div class="section-heading"><div><p class="eyebrow">ENTRADA DE DADOS</p><h2>Atualize os três relatórios</h2></div><span class="muted">Processamento local no navegador</span></div>
      <div class="upload-grid">
        <label class="upload-card" id="upload-card-meetings"><span class="upload-icon">01</span><span class="upload-state" aria-label="Aguardando upload">○</span><strong>Reuniões</strong><small>Reuniões.xlsx</small><span class="upload-latest">Ainda não importado</span><input id="meeting-file" type="file" accept=".xlsx,.xls,.csv" /></label>
        <label class="upload-card" id="upload-card-tasks"><span class="upload-icon">02</span><span class="upload-state" aria-label="Aguardando upload">○</span><strong>Tarefas</strong><small>Tarefas.xlsx</small><span class="upload-latest">Ainda não importado</span><input id="task-file" type="file" accept=".xlsx,.xls,.csv" /></label>
        <label class="upload-card" id="upload-card-payments"><span class="upload-icon">03</span><span class="upload-state" aria-label="Aguardando upload">○</span><strong>Pagamentos</strong><small>CSV ou XLSX</small><span class="upload-latest">Ainda não importado</span><input id="payment-file" type="file" accept=".xlsx,.xls,.csv" /></label>
      </div>
      <div class="upload-feedback" id="upload-feedback">Carregue os arquivos para preencher a linha do tempo. Os arquivos já existentes na pasta não são lidos automaticamente pelo navegador.</div>
    </section>

    <section class="filters">
      <div class="filter-block"><label for="segment">Visão</label><select id="segment"><option value="all">Todas</option><option value="internal">Internos</option><option value="external">Externos</option></select></div>
      <div class="filter-block"><label for="classification">Classificação do cliente</label><select id="classification"><option value="all">Todas as classificações</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></div>
      <div class="filter-block"><label for="month">Competência</label><select id="month"><option value="all">Todos os meses</option></select></div>
      <button id="settings-button" class="button secondary" type="button">Calendário</button>
    </section>

    <nav class="indicator-tabs" aria-label="Grupos de indicadores">
      <button class="indicator-tab is-active" data-tab="volume" type="button">Volume</button>
      <button class="indicator-tab" data-tab="productivity" type="button">Produtividade</button>
      <button class="indicator-tab" data-tab="cost" type="button">Custo</button>
      <button class="indicator-tab" data-tab="quality" type="button">Qualidade</button>
    </nav>
    <section id="indicator-panel"></section>
    <section class="detail-section"><details><summary>Detalhes de status cancelados e registros desconsiderados</summary><div id="status-details" class="detail-content">Nenhum dado carregado.</div></details></section>
    <section class="settings-drawer" id="settings-drawer" hidden><div class="drawer-head"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2>Calendário de competência</h2></div><button id="close-settings" class="icon-button" type="button" aria-label="Fechar">×</button></div><p class="muted">A jornada considera 9 horas de segunda a quinta e 8 horas na sexta, já descontado o almoço. Cadastre datas adicionais individualmente.</p><div class="date-row"><input id="excluded-date" type="date" /><button id="add-date" class="button" type="button">Adicionar data</button></div><div id="excluded-dates" class="date-list"></div><div class="api-note"><strong>Integração de classificação</strong><span id="api-status">Secret key não configurada. A estrutura está pronta em <code>.env</code>.</span></div></section>
  </main>
`;

const $ = (selector) => document.querySelector(selector);
const inputBindings = [['meeting-file', 'meetings'], ['task-file', 'tasks'], ['payment-file', 'payments']];

inputBindings.forEach(([id, kind]) => $( `#${id}` ).addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state[kind] = mergeRows(kind, normalizeRows(await readFile(file), kind));
    const latest = [...new Set(state[kind].map((item) => item.month).filter(Boolean))].sort().at(-1) || '';
    state.fileMeta[kind] = { name: file.name, latest, loaded: true };
    persistState();
    $('#upload-feedback').textContent = `${file.name} carregado: ${state[kind].length.toLocaleString('pt-BR')} registros válidos para análise.`;
    render();
  } catch (error) {
    $('#upload-feedback').textContent = `Não foi possível ler ${file.name}: ${error.message}`;
  }
}));

$('#segment').addEventListener('change', (event) => { state.segment = event.target.value; render(); });
$('#classification').addEventListener('change', (event) => { state.classification = event.target.value; render(); });
$('#month').addEventListener('change', (event) => { state.month = event.target.value; render(); });
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { state.activeTab = button.dataset.tab; render(); }));
$('#settings-button').addEventListener('click', () => { $('#settings-drawer').hidden = false; });
$('#close-settings').addEventListener('click', () => { $('#settings-drawer').hidden = true; });
$('#add-date').addEventListener('click', () => {
  const date = $('#excluded-date').value;
  if (date) state.excludedDates.add(date);
  $('#excluded-date').value = '';
  persistState();
  renderExcludedDates();
});

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

function normalizeDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number') return new Date(Math.round((raw - 25569) * 86400 * 1000));
  const text = String(raw).trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(raw) {
  const date = normalizeDate(raw);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : null;
}

function normalizeNumber(raw) {
  if (typeof raw === 'number') return raw;
  const text = String(raw ?? '').replace(/R\$\s?/g, '').trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return Number(normalized) || 0;
}

function normalizeRows(rows, kind) {
  return rows.map((row) => {
    const status = String(value(row, ['Status'])).trim();
    const nid = String(value(row, ['NID'])).replace(/^#/, '').trim();
    const client = String(value(row, ['Cliente', 'Entidade'])).trim();
    const date = monthKey(value(row, kind === 'meetings' ? ['Data'] : kind === 'tasks' ? ['Vencimento'] : ['Vencimento']));
    const minutes = kind === 'meetings' ? normalizeNumber(value(row, ['Duração'])) / 60 : normalizeNumber(value(row, ['Duração'])) * 60;
    return { status, nid, client, month: date, minutes, classification: String(value(row, ['Classificação', 'classification'])).trim(), account: String(value(row, ['Planos de contas'])).trim(), parcel: String(value(row, ['Parcela'])).trim(), paid: kind !== 'payments' || status.toLowerCase() === 'pago', amount: kind === 'payments' ? normalizeNumber(value(row, ['Valor pago'])) : 0, participant: String(value(row, kind === 'meetings' ? ['Participantes', 'Participantes/Cliente'] : ['Responsável'])).trim() };
  }).filter((item) => item.month);
}

function recordKey(kind, item) {
  if (kind === 'payments') return [item.nid, item.parcel, item.month, item.account, item.amount].join('|');
  return item.nid || [item.client, item.month, item.status, item.participant].join('|');
}

function mergeRows(kind, incoming) {
  const merged = new Map(state[kind].map((item) => [recordKey(kind, item), item]));
  incoming.forEach((item) => merged.set(recordKey(kind, item), item));
  return [...merged.values()];
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
  const compact = (items) => items.map(({ row, ...item }) => item);
  return { meetings: compact(state.meetings), tasks: compact(state.tasks), payments: compact(state.payments), fileMeta: state.fileMeta, excludedDates: [...state.excludedDates] };
}

async function persistState() {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).put(serializableState(), 'current');
    transaction.oncomplete = () => database.close();
  } catch {
    // IndexedDB is the durable store; the UI remains usable if browser storage is disabled.
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
    const compact = (items) => (items || []).map(({ row, ...item }) => item);
    state.meetings = compact(source.meetings);
    state.tasks = compact(source.tasks);
    state.payments = compact(source.payments);
    state.fileMeta = { ...state.fileMeta, ...(source.fileMeta || {}) };
    state.excludedDates = new Set(source.excludedDates || []);
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

function unique(items, key) { return new Set(items.map((item) => item[key]).filter(Boolean)).size; }
function formatNumber(number, digits = 0) { return Number(number || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function formatHours(minutes) { return `${formatNumber(minutes / 60, 1)} h`; }
function formatCurrency(valueToFormat) { return Number(valueToFormat || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function monthLabel(month) { const [year, monthNumber] = month.split('-'); const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; return `${names[Number(monthNumber) - 1]}/${year}`; }
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
    const key = item.nid || `${item.client}-${item.month}-${item.status}-${item.participant}`;
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
  return { meetings: selectedMeetings, tasks: selectedTasks, payments, activities, capacity, minutes, clients: unique(activities, 'client'), people: unique(activities, 'participant'), cost: payments.reduce((sum, item) => sum + item.amount, 0), costByPlan };
}

function render() {
  const months = availableMonths();
  const monthSelect = $('#month');
  const selected = state.month;
  monthSelect.innerHTML = `<option value="all">Todos os meses</option>${months.map((month) => `<option value="${month}">${monthLabel(month)}</option>`).join('')}`;
  monthSelect.value = months.includes(selected) || selected === 'all' ? selected : 'all';
  state.month = monthSelect.value;
  renderIndicatorPanel(months);
  renderDetails();
  renderExcludedDates();
  renderUploadStatus();
  $('#data-status').textContent = months.length ? `${months.length} competências carregadas` : 'Aguardando dados';
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
  if (!months.length) { table.className = 'indicator-table-wrap empty-state'; table.textContent = 'Faça os uploads para visualizar a linha do tempo.'; return; }
  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  $('#timeline-range').textContent = `${monthLabel(visible[0])} até ${monthLabel(visible[visible.length - 1])}`;
  const rows = timelineRows(state.activeTab, visible);
  const comparison = comparisonPeriod(visible);
  table.innerHTML = `<table class="indicator-table"><thead><tr><th>Indicador</th><th>${comparison.previousLabel}</th><th>${comparison.currentLabel}</th><th>Variação</th>${visible.map((month) => `<th>${monthLabel(month)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => { const previous = accumulated(row, comparison.previousMonths, comparison.endMonth); const current = accumulated(row, comparison.currentMonths, comparison.endMonth); const variation = previous ? (current / previous - 1) * 100 : null; return `<tr class="${row.section ? 'table-section-row' : ''}"><th>${row.label}</th><td>${row.format(previous)}</td><td>${row.format(current)}</td><td class="variation-cell ${variationClass(variation)}">${variation === null ? '-' : `${formatNumber(variation, 2)}%`}</td>${visible.map((month) => `<td>${row.format(row.value(month))}</td>`).join('')}</tr>`; }).join('')}</tbody></table>`;
  requestAnimationFrame(() => { table.scrollLeft = table.scrollWidth; });
}

function comparisonPeriod(months) {
  const endMonth = Number(months[months.length - 1].split('-')[1]);
  const currentYear = Number(months[months.length - 1].split('-')[0]);
  const previousYear = currentYear - 1;
  const range = (year) => months.filter((month) => Number(month.split('-')[0]) === year && Number(month.split('-')[1]) <= endMonth);
  return { endMonth, currentMonths: range(currentYear), previousMonths: range(previousYear), previousLabel: `jan/${String(previousYear).slice(-2)} a ${shortMonth(endMonth)}/${String(previousYear).slice(-2)}`, currentLabel: `jan/${String(currentYear).slice(-2)} a ${shortMonth(endMonth)}/${String(currentYear).slice(-2)}` };
}

function shortMonth(monthNumber) { return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][monthNumber - 1]; }

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

function workingDays(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  let days = 0;
  for (let day = 1; day <= lastDay; day += 1) if (!dateIsExcluded(new Date(year, monthNumber - 1, day))) days += 1;
  return days;
}

function renderUploadStatus() {
  Object.entries(state.fileMeta).forEach(([kind, meta]) => {
    const card = $(`#upload-card-${kind}`);
    if (!card) return;
    card.classList.toggle('is-loaded', meta.loaded);
    const stateIcon = card.querySelector('.upload-state');
    const latest = card.querySelector('.upload-latest');
    stateIcon.textContent = meta.loaded ? '✓' : '○';
    stateIcon.setAttribute('aria-label', meta.loaded ? 'Upload concluído' : 'Aguardando upload');
    latest.textContent = meta.loaded ? latestLabel(meta.latest) : 'Ainda não importado';
    latest.title = meta.name || '';
  });
}

function renderSummary(months) {
  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  const metrics = visible.reduce((total, month) => {
    const current = metricsFor(month);
    total.meetings += current.meetings.length; total.tasks += current.tasks.length; total.minutes += current.minutes; total.cost += current.cost; total.clients += current.clients; return total;
  }, { meetings: 0, tasks: 0, minutes: 0, cost: 0, clients: 0 });
  const cards = state.segment === 'internal' ? [['Tarefas finalizadas', metrics.tasks], ['Horas apontadas', formatHours(metrics.minutes)], ['Clientes atendidos', metrics.clients], ['Custos pagos', formatCurrency(metrics.cost)]] : state.segment === 'external' ? [['Reuniões finalizadas', metrics.meetings], ['Horas de reuniões', formatHours(metrics.minutes)], ['Clientes atendidos', metrics.clients], ['Custos pagos', formatCurrency(metrics.cost)]] : [['Atividades finalizadas', metrics.meetings + metrics.tasks], ['Horas apontadas', formatHours(metrics.minutes)], ['Clientes atendidos', metrics.clients], ['Custos pagos', formatCurrency(metrics.cost)]];
  $('#summary-grid').innerHTML = cards.map(([label, valueToShow], index) => `<article class="metric-card metric-${index}"><span>${label}</span><strong>${typeof valueToShow === 'number' ? formatNumber(valueToShow) : valueToShow}</strong><small>${state.month === 'all' ? 'período completo' : monthLabel(state.month)}</small></article>`).join('');
}

function renderProductivity(months) {
  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  const metrics = visible.reduce((total, month) => {
    const current = metricsFor(month);
    total.minutes += current.minutes; total.capacity += current.capacity; total.clients += current.clients; total.activities += current.activities.length; return total;
  }, { minutes: 0, capacity: 0, clients: 0, activities: 0 });
  const occupation = metrics.capacity ? (metrics.minutes / 60 / metrics.capacity) * 100 : 0;
  const cards = [['Capacidade disponível', `${formatNumber(metrics.capacity)} h`], ['Horas apontadas', formatHours(metrics.minutes)], ['Ocupação', `${formatNumber(occupation, 1)}%`], ['Atividades por cliente', formatNumber(metrics.clients ? metrics.activities / metrics.clients : 0, 1)]];
  $('#summary-grid').innerHTML = cards.map(([label, valueToShow], index) => `<article class="metric-card metric-${index}"><span>${label}</span><strong>${valueToShow}</strong><small>${state.month === 'all' ? 'período completo' : monthLabel(state.month)}</small></article>`).join('');
}

function renderCost(months) {
  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  const metrics = visible.reduce((total, month) => { const current = metricsFor(month); total.cost += current.cost; total.hours += current.minutes / 60; total.plans += Object.keys(current.costByPlan).length; return total; }, { cost: 0, hours: 0, plans: 0 });
  const cards = [['Total pago', formatCurrency(metrics.cost)], ['Custo por hora', formatCurrency(metrics.hours ? metrics.cost / metrics.hours : 0)], ['Planos movimentados', formatNumber(metrics.plans)], ['Competências', formatNumber(visible.length)]];
  $('#summary-grid').innerHTML = cards.map(([label, valueToShow], index) => `<article class="metric-card metric-${index}"><span>${label}</span><strong>${valueToShow}</strong><small>${state.month === 'all' ? 'período completo' : monthLabel(state.month)}</small></article>`).join('');
}

function renderQuality(months) {
  const source = [...state.meetings, ...state.tasks].filter((item) => item.month && (state.month === 'all' || item.month === state.month));
  const cancelled = source.filter((item) => item.status.toLowerCase().includes('cancel')).length;
  const finalized = source.filter((item) => item.status === 'Finalizado').length;
  const pending = source.length - cancelled - finalized;
  const cards = [['Finalizados', finalized], ['Cancelados', cancelled], ['Em andamento', pending], ['Taxa de conclusão', `${formatNumber(source.length ? finalized / source.length * 100 : 0, 1)}%`]];
  $('#summary-grid').innerHTML = cards.map(([label, valueToShow], index) => `<article class="metric-card metric-${index}"><span>${label}</span><strong>${typeof valueToShow === 'number' ? formatNumber(valueToShow) : valueToShow}</strong><small>${state.month === 'all' ? 'período completo' : monthLabel(state.month)}</small></article>`).join('');
}

function renderTimeline(months) {
  const timeline = $('#timeline');
  if (!months.length) { timeline.className = 'timeline empty-state'; timeline.textContent = 'Faça os três uploads para visualizar os meses.'; $('#timeline-range').textContent = 'Sem competência carregada'; return; }
  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  $('#timeline-range').textContent = `${monthLabel(visible[0])} até ${monthLabel(visible[visible.length - 1])}`;
  timeline.className = 'timeline';
  timeline.innerHTML = visible.map((month) => {
    const metrics = metricsFor(month);
    const occupation = metrics.capacity ? (metrics.minutes / 60 / metrics.capacity) * 100 : 0;
    const plans = Object.entries(metrics.costByPlan).sort(([, first], [, second]) => second - first).map(([plan, amount]) => `<span class="plan-row"><b>${plan}</b><strong>${formatCurrency(amount)}</strong></span>`).join('') || '<span class="muted">Sem pagamentos pagos nesta competência.</span>';
    return `<article class="month-card"><div class="month-head"><div><span class="month-label">${monthLabel(month)}</span><h3>${formatNumber(metrics.activities.length)} atividades finalizadas</h3></div><span class="month-cost">${formatCurrency(metrics.cost)}</span></div><div class="bar"><span style="width:${Math.min(occupation, 100)}%"></span></div><div class="month-stats"><span><b>${formatHours(metrics.minutes)}</b> apontadas</span><span><b>${formatNumber(metrics.clients)}</b> clientes</span><span><b>${formatNumber(metrics.people)}</b> pessoas</span><span><b>${formatNumber(metrics.capacity, 0)} h</b> capacidade</span></div><details class="plan-details"><summary>Custos por plano de contas</summary><div>${plans}</div></details></article>`;
  }).join('');
}

function renderDetails() {
  const cancellations = [...state.meetings, ...state.tasks].filter((item) => item.status.toLowerCase().includes('cancel')).reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
  const ignored = [...state.meetings, ...state.tasks].filter((item) => item.status && item.status !== 'Finalizado' && !meetingStatuses.has(item.status) && !taskStatuses.has(item.status)).length;
  const entries = Object.entries(cancellations);
  $('#status-details').innerHTML = entries.length ? `${entries.map(([status, count]) => `<span class="status-row"><b>${status}</b><strong>${formatNumber(count)}</strong></span>`).join('')}<span class="status-row"><b>Registros com status não mapeado</b><strong>${formatNumber(ignored)}</strong></span>` : '<p class="muted">Nenhum cancelamento carregado.</p>';
}

function renderExcludedDates() {
  $('#excluded-dates').innerHTML = [...state.excludedDates].sort().map((date) => `<span class="date-chip">${date}<button type="button" data-date="${date}" aria-label="Remover data">×</button></span>`).join('') || '<span class="muted">Nenhuma data adicional.</span>';
  $('#excluded-dates').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { state.excludedDates.delete(button.dataset.date); renderExcludedDates(); render(); }));
}

restoreState().finally(render);