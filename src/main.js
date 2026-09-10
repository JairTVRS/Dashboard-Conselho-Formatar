import * as XLSX from 'xlsx';
import './style.css';
import { monthKey, monthLabel, dateTimeLabel } from './lib/dates.js';
import { formatNumber } from './lib/format.js';
import { tableMarkup } from './ui/table.js';
import { areas, areaById, areaByPath } from './areas/index.js';
import { syncPhases, recentWindow, syncWindow, fetchClassifications, syncRange, testConnection, HubError } from './api/hub.js';
import { initTheme } from './theme.js';

const STORAGE_KEY = 'formatar-dashboard-operational-data-v1';
const SHELL_KEY = 'formatar-dashboard-shell-v1';
const DATABASE_NAME = 'formatar-dashboard-storage';
const DATABASE_VERSION = 1;
const DATABASE_STORE = 'dashboard-state';
const COLLAPSE_BREAKPOINT = 1100;

const state = {
  data: { meetings: [], tasks: [], payments: [], classifications: {} },
  fileMeta: { payments: { name: '', latest: '', loaded: false } },
  // `coverage` é a faixa de competência realmente carregada de ponta a ponta.
  // Só ela decide o que a tela exibe; linhas fora dela ficam no cache esperando.
  sync: { lastSync: '', running: false, error: '', message: '', coverage: null, phase: null, waitUntil: 0, waitStage: '' },
  excludedDates: new Set(),
  month: 'all',
  area: 'operacoes',
  sidebarCollapsed: window.innerWidth < COLLAPSE_BREAKPOINT,
  areaFilters: {}
};

areas.forEach((area) => { state.areaFilters[area.id] = { ...area.defaultFilters }; });
const activeTabs = Object.fromEntries(areas.map((area) => [area.id, area.tabs[0]?.id || '']));

const GEAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="currentColor"/><path d="m19.4 13.5.1-1.5-.1-1.5 1.7-1.3a.8.8 0 0 0 .2-1l-1.6-2.8a.8.8 0 0 0-1-.3l-2 .8a7.6 7.6 0 0 0-2.6-1.5l-.3-2.1a.8.8 0 0 0-.8-.7h-3.2a.8.8 0 0 0-.8.7l-.3 2.1a7.6 7.6 0 0 0-2.6 1.5l-2-.8a.8.8 0 0 0-1 .3L2.7 8.2a.8.8 0 0 0 .2 1l1.7 1.3-.1 1.5.1 1.5-1.7 1.3a.8.8 0 0 0-.2 1l1.6 2.8a.8.8 0 0 0 1 .3l2-.8a7.6 7.6 0 0 0 2.6 1.5l.3 2.1a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7l.3-2.1a7.6 7.6 0 0 0 2.6-1.5l2 .8a.8.8 0 0 0 1-.3l1.6-2.8a.8.8 0 0 0-.2-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const SUN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z"/></svg>';
const RAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="layout">
    <nav class="sidebar" id="sidebar" aria-label="Áreas do dashboard">
      <button id="sidebar-toggle" class="rail-toggle" type="button" aria-label="Recolher navegação">${RAIL_ICON}</button>
      <ul class="rail">
        ${areas.map((area) => `<li><a class="rail-item" data-area="${area.id}" href="${area.path}" title="${area.label}"><span class="rail-icon">${area.icon}</span><span class="rail-label">${area.label}</span></a></li>`).join('')}
      </ul>
      <div class="rail-footer">
        <div class="rail-actions">
          <button id="theme-toggle" class="rail-action" type="button" aria-label="Alternar tema">${SUN_ICON}${MOON_ICON}</button>
          <button id="settings-toggle" class="rail-action" type="button" aria-label="Configurações de dados e integrações" title="Configurações de dados e integrações">${GEAR_ICON}</button>
        </div>
        <span class="rail-version" title="Versão publicada">v${__APP_VERSION__}</span>
      </div>
    </nav>

    <main class="shell">
      <header class="hero">
        <div class="hero-brand">
          <img id="brand-logo" class="brand-logo" alt="Formatar — Gestão e Governança" width="964" height="267" />
          <div>
            <p class="eyebrow" id="area-eyebrow"></p>
            <h1 id="area-title"></h1>
            <p class="hero-copy" id="area-subtitle"></p>
          </div>
        </div>
        <div class="hero-actions">
          <button type="button" class="hero-badge" id="data-status-button" title="Abrir configurações de dados"><span class="pulse"></span><span id="data-status">Aguardando dados</span></button>
        </div>
      </header>

      <section class="filters" id="filters"></section>
      <nav class="indicator-tabs" id="indicator-tabs" aria-label="Grupos de indicadores"></nav>
      <section id="indicator-panel"></section>
      <section class="detail-section" id="detail-section" hidden><details><summary id="detail-summary"></summary><div id="status-details" class="detail-content"></div></details></section>
    </main>
  </div>

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
        <span>Em <em>Cloudflare Pages → Configurações → Variáveis e segredos</em>, crie um segredo chamado <code>HUB_API_SECRET_KEY</code> com o valor da secret key e faça um novo deploy. Em desenvolvimento, use um arquivo <code>.env.local</code> com a mesma variável.</span>
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
restoreShell();

/* Navegação --------------------------------------------------------------- */

function currentArea() {
  return areaById(state.area);
}

function navigate(areaId, { push = true } = {}) {
  const area = areaById(areaId);
  state.area = area.id;
  if (push && window.location.pathname !== area.path) window.history.pushState({ area: area.id }, '', area.path);
  persistShell();
  render();
}

document.querySelectorAll('[data-area]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  navigate(link.dataset.area);
}));

window.addEventListener('popstate', () => navigate(areaByPath(window.location.pathname).id, { push: false }));

$('#sidebar-toggle').addEventListener('click', () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  persistShell();
  renderSidebar();
});

/* Ações do cabeçalho e do drawer ------------------------------------------ */

$('#payment-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.data.payments = mergePayments(normalizePaymentRows(await readFile(file)));
    const latest = [...new Set(state.data.payments.map((item) => item.month).filter(Boolean))].sort().at(-1) || '';
    state.fileMeta.payments = { name: file.name, latest, loaded: true };
    persistState();
    $('#upload-feedback').textContent = `${file.name} carregado: ${state.data.payments.length.toLocaleString('pt-BR')} registros válidos para análise.`;
    render();
  } catch (error) {
    $('#upload-feedback').textContent = `Não foi possível ler ${file.name}: ${error.message}`;
  }
});

$('#settings-toggle').addEventListener('click', () => toggleDrawer(true));
// A engrenagem lembra a última aba aberta; vindo do badge, o assunto é sempre Dados.
$('#data-status-button').addEventListener('click', () => {
  document.querySelectorAll('[data-drawer-tab]').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.drawerTab === 'data'));
  document.querySelectorAll('[data-drawer-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.drawerPanel === 'data'));
  toggleDrawer(true);
});
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

/* Importação de pagamentos ------------------------------------------------ */

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

function paymentKey(item) {
  return [item.nid, item.parcel, item.month, item.account, item.amount].join('|');
}

function mergePayments(incoming) {
  const merged = new Map(state.data.payments.map((item) => [paymentKey(item), item]));
  incoming.forEach((item) => merged.set(paymentKey(item), item));
  return [...merged.values()];
}

function activityKey(item) {
  return item.id || item.nid || [item.client, item.month, item.status, item.participant].join('|');
}

function mergeActivities(kind, incoming) {
  const merged = new Map(state.data[kind].map((item) => [activityKey(item), item]));
  incoming.forEach((item) => merged.set(activityKey(item), item));
  return [...merged.values()];
}

/* Sincronização ------------------------------------------------------------ */

const STAGE_LABELS = { customers: 'clientes', meetings: 'reuniões', tasks: 'tarefas' };

/**
 * A API informa o tempo de bloqueio uma única vez, quando recusa a chamada. Guardar
 * o instante em que a janela reabre permite contar para baixo na tela — parado em
 * "43s" por quase um minuto, o dashboard parece travado.
 */
let waitTimer = null;

function startWaitTimer(seconds, stage) {
  state.sync.waitUntil = Date.now() + seconds * 1000;
  state.sync.waitStage = stage;
  if (waitTimer) return;
  waitTimer = setInterval(() => { renderSyncStatus(); renderDataStatus(); }, 1000);
}

function stopWaitTimer() {
  if (waitTimer) clearInterval(waitTimer);
  waitTimer = null;
  state.sync.waitUntil = 0;
  state.sync.waitStage = '';
}

/** Segundos restantes, ou `null` quando não há espera em curso. */
function waitSeconds() {
  if (!state.sync.waitUntil) return null;
  return Math.max(0, Math.ceil((state.sync.waitUntil - Date.now()) / 1000));
}

/** Zero não vira "0s" parado: a janela pode demorar um instante a mais para reabrir. */
function waitMessage() {
  const seconds = waitSeconds();
  if (seconds === null) return '';
  const alvo = STAGE_LABELS[state.sync.waitStage] || 'a carga';
  const note = state.sync.phase?.background ? ' O comparativo com o ano anterior fica disponível ao terminar.' : '';
  return seconds > 0
    ? `Limite de requisições da API atingido. Retomando ${alvo} em ${seconds}s.${note}`
    : `Limite de requisições da API atingido. Retomando ${alvo}…${note}`;
}

function syncBadgeText() {
  const seconds = waitSeconds();
  if (seconds !== null) return seconds > 0 ? `Limite da API · retomando em ${seconds}s` : 'Limite da API · retomando…';
  const phase = state.sync.phase;
  // Sem fase é a atualização de quem já tem a janela coberta: não há mês a numerar.
  if (!phase) return 'Atualizando dados recentes';
  return `Sincronizando ${phase.label} · mês ${phase.position} de ${phase.total}`;
}

/** Guarda o que chegou. A tela só passa a exibir quando a cobertura avançar. */
async function commitRows(patch) {
  if (patch.meetings) state.data.meetings = applyClassifications(mergeActivities('meetings', patch.meetings));
  if (patch.tasks) state.data.tasks = applyClassifications(mergeActivities('tasks', patch.tasks));
  await persistState();
}

/**
 * Busca a classificação dos clientes e reaplica ao que já está em cache. Roda depois
 * do primeiro mês, para não segurar a primeira competência na tela.
 */
async function refreshClassifications(onProgress) {
  const classifications = await fetchClassifications({ onProgress });
  state.data.classifications = classifications;
  state.data.meetings = applyClassifications(state.data.meetings);
  state.data.tasks = applyClassifications(state.data.tasks);
  await persistState();
  render();
  return classifications;
}

/** Estende a cobertura para trás; as fases vêm da mais recente para a mais antiga. */
function extendCoverage({ start, end }) {
  const current = state.sync.coverage;
  state.sync.coverage = {
    from: current && current.from < start ? current.from : start,
    to: current && current.to > end ? current.to : end
  };
}

function syncProgress(progress) {
  return ({ stage, loaded, total, waitingSeconds }) => {
    const phase = state.sync.phase;
    const scope = phase ? ` de ${phase.label}` : '';
    // A partir da segunda fase a carga é de fundo: dizer o que ela destrava evita
    // que as colunas ausentes pareçam defeito.
    const note = phase?.background ? ' O comparativo com o ano anterior fica disponível ao terminar.' : '';

    if (waitingSeconds) {
      startWaitTimer(waitingSeconds, stage);
      renderSyncStatus();
      renderDataStatus();
      return;
    }
    stopWaitTimer();
    const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    progress.firstElementChild.style.width = `${percent}%`;
    state.sync.message = `Carregando ${STAGE_LABELS[stage]}${scope}: ${loaded.toLocaleString('pt-BR')}${total ? ` de ${total.toLocaleString('pt-BR')}` : ''}.${note}`;
    renderSyncStatus();
    renderDataStatus();
  };
}

/**
 * Fases que ainda faltam, da mais recente para a mais antiga. A comparação é só
 * pela borda antiga: a janela termina em "hoje" e avança todo dia, e essa ponta
 * quem cobre é a recarga da faixa recente. Comparar pela borda nova faria a fase
 * de 6 meses recomeçar do zero a cada dia.
 */
function pendingPhases() {
  const coverage = state.sync.coverage;
  return syncPhases().filter((phase) => !coverage || phase.start < coverage.from);
}

async function runSync({ incremental }) {
  if (state.sync.running) return;
  state.sync.running = true;
  state.sync.error = '';
  if (!incremental) state.sync.coverage = null;
  renderSyncStatus();
  renderDataStatus();

  const progress = $('#sync-progress');
  progress.hidden = false;
  const onProgress = syncProgress(progress);

  try {
    const phases = pendingPhases();

    if (phases.length) {
      // Carga mês a mês, do mais recente para o mais antigo, cada um encadeando o
      // seguinte. As classificações são 10 páginas e não entram em nenhum número da
      // tabela — buscá-las antes atrasaria o primeiro mês em segundos que a pessoa
      // passa olhando para tela vazia, então elas vêm logo depois.
      const total = syncPhases().length;
      for (let index = 0; index < phases.length; index += 1) {
        const phase = phases[index];
        // Numeração global: quem volta com parte da janela já coberta retoma do meio.
        state.sync.phase = { label: phase.label, background: index > 0, position: total - phases.length + index + 1, total };
        renderSyncStatus();
        await syncRange({ ...phase, classifications: state.data.classifications, onProgress, onStageDone: commitRows });
        extendCoverage(phase);
        state.sync.lastSync = new Date().toISOString();
        await persistState();
        render();
        if (index === 0) await refreshClassifications(onProgress);
      }
    } else {
      const classifications = await refreshClassifications(onProgress);
      // Período já coberto: puxa o que mudou. A faixa recente vai sem filtro de
      // `updatedAt` porque um registro pode entrar na janela só pelo tempo passar —
      // uma tarefa que vence hoje, criada e não tocada há semanas, o filtro perderia.
      const recent = recentWindow();
      await syncRange({ ...recent, classifications, onProgress, onStageDone: commitRows });
      const covered = state.sync.coverage;
      if (covered && covered.from < recent.start) {
        await syncRange({ start: covered.from, end: recent.start, since: state.sync.lastSync, classifications, onProgress, onStageDone: commitRows });
      }
      extendCoverage({ start: recent.start, end: syncWindow().end });
      state.sync.lastSync = new Date().toISOString();
    }

    state.sync.phase = null;
    state.sync.message = describeCoverage();
    await persistState();
    render();
  } catch (error) {
    state.sync.phase = null;
    state.sync.error = error instanceof HubError ? error.message : `Falha na sincronização: ${error.message}`;
    state.sync.message = '';
  } finally {
    stopWaitTimer();
    state.sync.running = false;
    progress.hidden = true;
    progress.firstElementChild.style.width = '0%';
    renderSyncStatus();
    renderDataStatus();
  }
}

/** Mensagem de fim: diz o que já dá para analisar e o que ainda falta. */
function describeCoverage() {
  const pending = pendingPhases();
  const totals = `${state.data.meetings.length.toLocaleString('pt-BR')} reuniões e ${state.data.tasks.length.toLocaleString('pt-BR')} tarefas em cache.`;
  if (!pending.length) return `Sincronização concluída: ${totals}`;
  const restam = `${pending.length} ${pending.length === 1 ? 'mês' : 'meses'}`;
  return `Carregando ${pending[0].label} em segundo plano, faltam ${restam} — o comparativo com o ano anterior fica disponível ao terminar. ${totals}`;
}

/** Reaplica a classificação vinda de `customers` a todos os registros em cache. */
function applyClassifications(items) {
  return items.map((item) => ({ ...item, classification: state.data.classifications[item.client] ?? item.classification ?? '' }));
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
  state.data = { meetings: [], tasks: [], payments: [], classifications: {} };
  state.fileMeta.payments = { name: '', latest: '', loaded: false };
  state.sync = { lastSync: '', running: false, error: '', message: 'Cache local apagado.', coverage: null, phase: null, waitUntil: 0, waitStage: '' };
  await persistState();
  render();
}

/* Persistência ------------------------------------------------------------- */

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
    meetings: state.data.meetings,
    tasks: state.data.tasks,
    payments: state.data.payments,
    classifications: state.data.classifications,
    fileMeta: state.fileMeta,
    excludedDates: [...state.excludedDates],
    lastSync: state.sync.lastSync,
    coverage: state.sync.coverage
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
    state.data.meetings = source.meetings || [];
    state.data.tasks = source.tasks || [];
    state.data.payments = source.payments || [];
    state.data.classifications = source.classifications || {};
    state.fileMeta = { ...state.fileMeta, ...(source.fileMeta || {}) };
    state.excludedDates = new Set(source.excludedDates || []);
    state.sync.lastSync = source.lastSync || '';
    state.sync.coverage = source.coverage || null;

    // Cache anterior à integração: as atividades vinham de planilha e não têm `id`.
    // A chave delas é o `nid`, e a das linhas da API é o `id`, então as mesmas
    // atividades entrariam duas vezes e todo indicador dobraria. Como reuniões e
    // tarefas hoje só vêm da API, essas linhas são descartadas — os pagamentos,
    // que continuam sendo importados à mão, ficam.
    if (!state.sync.coverage) {
      state.data.meetings = state.data.meetings.filter((item) => item.id);
      state.data.tasks = state.data.tasks.filter((item) => item.id);
    }
    if (legacy) {
      await persistState();
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    state.data.meetings = [];
    state.data.tasks = [];
    state.data.payments = [];
  }
}

function persistShell() {
  try {
    localStorage.setItem(SHELL_KEY, JSON.stringify({ area: state.area, sidebarCollapsed: state.sidebarCollapsed }));
  } catch {
    // Preferência de navegação é conveniência local; o shell funciona sem ela.
  }
}

function restoreShell() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SHELL_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (saved && typeof saved.sidebarCollapsed === 'boolean') state.sidebarCollapsed = saved.sidebarCollapsed;
  state.area = areaByPath(window.location.pathname).id;
}

/* Renderização ------------------------------------------------------------- */

function context() {
  return {
    data: state.data,
    month: state.month,
    excludedDates: state.excludedDates,
    filters: state.areaFilters[state.area] || {}
  };
}

function availableMonths() {
  const coverage = state.sync.coverage;
  const inCoverage = (month) => !coverage || (month >= coverage.from.slice(0, 7) && month <= coverage.to.slice(0, 7));

  // Recorta pela cobertura, senão um `Pagamentos.csv` com linhas de 2025 traria os
  // meses de 2025 de volta à tabela durante a primeira fase, exibindo zero em
  // reuniões e tarefas — número errado com cara de certo.
  const months = [...new Set([...state.data.meetings, ...state.data.tasks, ...state.data.payments].map((item) => item.month).filter(Boolean))]
    .filter(inCoverage)
    .sort();
  if (months.length < 2) return months;
  const result = [];
  const [startYear, startMonth] = months[0].split('-').map(Number);
  const [endYear, endMonth] = months[months.length - 1].split('-').map(Number);
  for (let cursor = new Date(startYear, startMonth - 1, 1); cursor <= new Date(endYear, endMonth - 1, 1); cursor.setMonth(cursor.getMonth() + 1)) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

function render() {
  const area = currentArea();
  const months = availableMonths();

  renderSidebar();
  $('#area-eyebrow').textContent = area.eyebrow;
  $('#area-title').textContent = area.title;
  $('#area-subtitle').textContent = area.subtitle;
  document.title = `${area.title} · Formatar`;

  renderFilters(area, months);
  renderTabs(area);
  renderIndicatorPanel(area, months);
  renderDetails(area);
  renderExcludedDates();
  renderUploadStatus();
  renderSyncStatus();
  renderDataStatus(months);
}

function renderSidebar() {
  $('#sidebar').classList.toggle('is-collapsed', state.sidebarCollapsed);
  $('#sidebar-toggle').setAttribute('aria-label', state.sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação');
  document.querySelectorAll('[data-area]').forEach((link) => {
    const active = link.dataset.area === state.area;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderFilters(area, months) {
  const container = $('#filters');
  const areaFilters = area.filters(context());
  const stored = state.areaFilters[area.id] || {};

  const monthOptions = `<option value="all">Todos os meses</option>${months.map((month) => `<option value="${month}">${monthLabel(month)}</option>`).join('')}`;
  const monthValue = months.includes(state.month) || state.month === 'all' ? state.month : 'all';
  state.month = monthValue;

  container.innerHTML = `
    ${areaFilters.map((filter) => `<div class="filter-block"><label for="filter-${filter.id}">${filter.label}</label><select id="filter-${filter.id}" data-filter="${filter.id}"${filter.disabled ? ' disabled' : ''}>${filter.options.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}</select></div>`).join('')}
    <div class="filter-block"><label for="month">Competência</label><select id="month">${monthOptions}</select></div>
  `;

  areaFilters.forEach((filter) => {
    const select = container.querySelector(`[data-filter="${filter.id}"]`);
    const values = filter.options.map((option) => String(option.value));
    const current = values.includes(String(stored[filter.id])) ? stored[filter.id] : filter.options[0]?.value;
    select.value = current;
    stored[filter.id] = current;
    select.addEventListener('change', (event) => {
      state.areaFilters[area.id][filter.id] = event.target.value;
      render();
    });
  });

  const monthSelect = container.querySelector('#month');
  monthSelect.value = monthValue;
  monthSelect.addEventListener('change', (event) => { state.month = event.target.value; render(); });
}

function renderTabs(area) {
  const nav = $('#indicator-tabs');
  nav.hidden = area.tabs.length === 0;
  nav.innerHTML = area.tabs.map((tab) => `<button class="indicator-tab${tab.id === activeTabs[area.id] ? ' is-active' : ''}" data-tab="${tab.id}" type="button">${tab.label}</button>`).join('');
  nav.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    activeTabs[area.id] = button.dataset.tab;
    render();
  }));
}

function renderIndicatorPanel(area, months) {
  const panel = $('#indicator-panel');
  const tab = area.tabs.find((item) => item.id === activeTabs[area.id]);
  const heading = tab ? `LINHA DO TEMPO / ${tab.label.toUpperCase()}` : area.eyebrow;
  const title = tab ? tab.label : area.label;

  panel.innerHTML = `<section class="table-section"><div class="section-heading"><div><p class="eyebrow">${heading}</p><h2>${title}</h2></div><span id="timeline-range" class="muted">Sem competência carregada</span></div><div id="indicator-table" class="indicator-table-wrap"></div></section>`;

  const table = $('#indicator-table');
  if (area.isEmpty(context()) || !months.length) {
    table.className = 'indicator-table-wrap empty-state';
    // Enquanto a primeira competência não fecha, mandar "sincronize na engrenagem"
    // é enganoso: a sincronização já está rodando e não há nada a fazer.
    table.textContent = state.sync.running && !area.pending ? syncingMessage() : area.emptyMessage;
    return;
  }

  const visible = state.month === 'all' ? months : months.filter((month) => month === state.month);
  $('#timeline-range').textContent = `${monthLabel(visible[0])} até ${monthLabel(visible[visible.length - 1])}`;
  table.className = 'indicator-table-wrap';
  table.innerHTML = tableMarkup(area.rows(activeTabs[area.id], visible, context()), visible);
  requestAnimationFrame(() => { table.scrollLeft = table.scrollWidth; });
}

function renderDetails(area) {
  const section = $('#detail-section');
  const details = area.details(context());
  section.hidden = !details;
  if (!details) return;
  $('#detail-summary').textContent = details.summary;
  $('#status-details').innerHTML = details.content;
}

function renderDataStatus(months) {
  const badge = $('#data-status');
  if (state.sync.running) { badge.textContent = syncBadgeText(); return; }
  if (state.sync.error) { badge.textContent = 'Falha na sincronização'; return; }
  // A lista só importa aqui. Calcular no parâmetro faria o relógio de espera varrer
  // dezenas de milhares de registros a cada segundo, sem usar o resultado.
  const list = months ?? availableMonths();
  badge.textContent = list.length ? `${list.length} competências carregadas` : 'Aguardando dados';
}

/** Texto da tela enquanto a primeira competência não fecha. */
function syncingMessage() {
  return waitMessage() || state.sync.message || 'Buscando dados no Hub. A primeira competência aparece em alguns segundos.';
}

function renderSyncStatus() {
  const period = syncWindow();
  $('#window-label').textContent = `${monthLabel(monthKey(period.start))} até ${monthLabel(monthKey(period.end))}`;
  $('#sync-when').textContent = state.sync.lastSync ? dateTimeLabel(state.sync.lastSync) : 'nunca';
  $('#sync-meetings').textContent = formatNumber(state.data.meetings.length);
  $('#sync-tasks').textContent = formatNumber(state.data.tasks.length);
  $('#sync-now').disabled = state.sync.running;
  $('#sync-full').disabled = state.sync.running;

  const live = waitMessage() || state.sync.message;
  const message = $('#sync-message');
  message.textContent = state.sync.error || live;
  message.className = `sync-message${state.sync.error ? ' is-error' : live ? ' is-ok' : ''}`;

  // O progresso chega a cada página; a tela vazia acompanha sem esperar o `render()`,
  // que só roda quando o mês fecha.
  const table = $('#indicator-table');
  if (state.sync.running && table?.classList.contains('empty-state')) table.textContent = syncingMessage();
}

function renderUploadStatus() {
  const meta = state.fileMeta.payments;
  const card = $('#upload-card-payments');
  card.classList.toggle('is-loaded', meta.loaded);
  const stateIcon = card.querySelector('.upload-state');
  const latest = card.querySelector('.upload-latest');
  stateIcon.textContent = meta.loaded ? '✓' : '○';
  stateIcon.setAttribute('aria-label', meta.loaded ? 'Upload concluído' : 'Aguardando upload');
  latest.textContent = meta.loaded ? (meta.latest ? `Dados mais recentes: ${monthLabel(meta.latest)}` : 'Sem competência válida') : 'Ainda não importado';
  latest.title = meta.name || '';
}

function renderExcludedDates() {
  const list = $('#excluded-dates');
  list.innerHTML = [...state.excludedDates].sort().map((date) => `<span class="date-chip">${date}<button type="button" data-date="${date}" aria-label="Remover data">×</button></span>`).join('') || '<span class="muted">Nenhuma data adicional.</span>';
  list.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    state.excludedDates.delete(button.dataset.date);
    persistState();
    renderExcludedDates();
    render();
  }));
}

restoreState().then(() => {
  render();
  runSync({ incremental: true });
});
