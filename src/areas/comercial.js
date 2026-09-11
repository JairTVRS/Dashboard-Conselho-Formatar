import { formatNumber, formatCurrency, formatClock } from '../lib/format.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h18l-7 8.2v6.4l-4 2.4v-8.8Z"/></svg>';

/** Recebimento é do cliente: não há como reparti-lo por time nem por grupo. */
const REVENUE_VIEWS = new Set(['revenue', 'revenuePerHour']);

/** Nome comparável: sem acento, sem pontuação e sem sufixo jurídico. */
function nameKey(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|SA|MEI)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * A matriz comercial conta o que a consultoria fatura. Recrutamento (Formatar RH) e
 * a assinatura de BI (Simple) são receita do mesmo cliente, mas as horas desta tela
 * são só de consultoria: somar os três distorceria o recebimento por hora de quem
 * contrata RH. O que fica de fora aparece no detalhe da área, com o valor.
 */
const RECEIPT_SCOPE = 'Consultoria Empresarial';

/**
 * Casa cada parcela recebida com um cliente pelo **nome**: a coluna `Entidade` do
 * relatório traz o Nome do cadastro, e o `NID` de lá identifica a parcela, não o
 * cliente — casar por ele encontraria o cliente errado por coincidência de número.
 * O que não casar é contado, nunca descartado em silêncio.
 */
function resolveReceipts(context) {
  const customers = context.data.customers || {};
  const byName = {};
  Object.entries(customers).forEach(([id, customer]) => {
    // O Nome vem primeiro porque é o que os relatórios do financeiro trazem; a razão
    // social entra depois e só ocupa as chaves que sobraram.
    [customer.name, customer.companyName].forEach((candidate) => {
      const key = nameKey(candidate);
      if (key && !byName[key]) byName[key] = id;
    });
  });

  const matched = [];
  const orphans = [];
  const outOfScope = [];
  (context.data.receipts || []).forEach((receipt) => {
    if (!receipt.paid || !receipt.month) return;
    if (receipt.costCenter !== RECEIPT_SCOPE) { outOfScope.push(receipt); return; }
    const id = byName[nameKey(receipt.client)] || '';
    if (id) matched.push({ ...receipt, client: id });
    else orphans.push(receipt);
  });
  return { matched, orphans, outOfScope };
}

function teamsOf(item, reference) {
  if (item.team) return [item.team];
  return reference.meetingTypeTeams?.[item.meetingType] || [];
}

/** Nada escolhido é "tudo": é como o filtro começa e é o que o campo mostra. */
const chosen = (selected, value) => !selected.length || selected.includes(value);

/**
 * Status do cliente, na ordem em que faz sentido escolher. O padrão da área é só
 * **Ativo**: a carteira tem 732 inativos contra 187 ativos, e sem esse recorte a
 * matriz abre dominada por quem já saiu.
 */
const CUSTOMER_STATUS = [
  { value: 'active', label: 'Ativo' },
  { value: 'ad_hoc', label: 'Ad hoc' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'inactive', label: 'Inativo' }
];

/**
 * Cliente sem status conhecido passa. Isso vale enquanto a sincronização não trouxe
 * o campo novo: o cache guardado por uma versão anterior não tem `status`, e recortar
 * por "ativo" ali esvaziaria a tela inteira até o próximo sync terminar.
 */
function statusAllows(context, client) {
  const selected = Array.isArray(context.filters?.status) ? context.filters.status : [];
  if (!selected.length) return true;
  const status = context.data.customers?.[client]?.status;
  return !status || selected.includes(status);
}

/** Filtros ativos, já considerando que as visões de recebimento ignoram time e grupo. */
function activeFilters(context, tab) {
  const filters = context.filters || {};
  const revenue = REVENUE_VIEWS.has(tab);
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    classification: list(filters.classification),
    team: revenue ? [] : list(filters.team),
    userGroup: revenue ? [] : list(filters.userGroup)
  };
}

/**
 * Uma atividade entra na matriz quando está finalizada, tem competência, tem cliente
 * e passa pelos filtros ativos. Exigir cliente é o que separa esta área de Operações:
 * reunião interna não pertence a linha nenhuma da matriz.
 */
function selects(context, tab) {
  const reference = context.data.reference || {};
  const { classification, team, userGroup } = activeFilters(context, tab);

  return (item) => {
    if (item.status !== 'Finalizado' || !item.month || !item.client) return false;
    if (!statusAllows(context, item.client)) return false;
    if (!chosen(classification, item.classification)) return false;
    if (team.length && !teamsOf(item, reference).some((id) => team.includes(id))) return false;
    if (userGroup.length && !item.people.some((person) => userGroup.includes(reference.userGroupOf?.[person]))) return false;
    return true;
  };
}

/**
 * A duração conta inteira — não se reparte uma reunião de uma hora entre times.
 * Já a contagem de participantes respeita o filtro: com o grupo "Consultores"
 * ativo, uma reunião de três pessoas soma só os consultores presentes.
 */
function peopleIn(item, context, tab) {
  const { userGroup } = activeFilters(context, tab);
  if (!userGroup.length) return item.people.length;
  const reference = context.data.reference || {};
  return item.people.filter((person) => userGroup.includes(reference.userGroupOf?.[person])).length;
}

function buildIndex(context, tab) {
  const index = new Map();
  const cell = (client, month) => {
    if (!index.has(client)) index.set(client, new Map());
    const months = index.get(client);
    if (!months.has(month)) months.set(month, { hours: 0, people: 0, meetings: 0, revenue: 0 });
    return months.get(month);
  };

  const selected = selects(context, tab);
  // Reuniões e tarefas somam juntas em duração e participantes, mas só a reunião
  // conta na aba de quantidade — por isso os dois laços em vez de um só.
  context.data.meetings.filter(selected).forEach((item) => {
    const entry = cell(item.client, item.month);
    entry.hours += (item.minutes || 0) / 60;
    entry.people += peopleIn(item, context, tab);
    entry.meetings += 1;
  });

  context.data.tasks.filter(selected).forEach((item) => {
    const entry = cell(item.client, item.month);
    entry.hours += (item.minutes || 0) / 60;
    entry.people += peopleIn(item, context, tab);
  });

  const { matched } = resolveReceipts(context);
  const { classification } = activeFilters(context, tab);
  matched.forEach((receipt) => {
    if (!statusAllows(context, receipt.client)) return;
    if (!chosen(classification, context.data.classifications?.[receipt.client] || '')) return;
    cell(receipt.client, receipt.month).revenue += receipt.amount || 0;
  });

  return index;
}

/**
 * Cada aba tem a sua métrica, e a linha só entra quando a métrica da aba tem valor.
 * Sem isso, um cliente que só aparece no relatório de recebimentos encheria a aba de
 * Tempo de duração com uma linha de zeros.
 */
const TAB_METRIC = {
  duration: 'hours',
  meetings: 'meetings',
  people: 'people',
  revenue: 'revenue',
  revenuePerHour: 'revenue'
};

export const comercial = {
  id: 'comercial',
  path: '/comercial',
  label: 'Comercial',
  icon: ICON,
  title: 'Indicadores Comerciais',
  subtitle: 'Matriz mensal por cliente de duração, reuniões, participantes e recebimento das atividades finalizadas.',
  eyebrow: 'CONSELHO FORMATAR / GESTÃO',

  tabs: [
    { id: 'duration', label: 'Tempo de duração' },
    { id: 'meetings', label: 'Qtd de reuniões' },
    { id: 'people', label: 'Qtd de participantes' },
    { id: 'revenue', label: 'Recebimento' },
    { id: 'revenuePerHour', label: 'Recebimento por hora' }
  ],

  labelHeader: 'Cliente',
  // A matriz nasce ordenada pela coluna de período do ano corrente, maior primeiro —
  // é como o relatório modelo se lê. Declarar isso como ordenação, em vez de deixar
  // implícito no ranking das linhas, acende a seta no cabeçalho: sem ela não dá para
  // saber por qual coluna a tabela está ordenada nem que basta clicar para inverter.
  defaultSort: { column: 'current', direction: 'desc' },
  defaultFilters: { status: ['active'], classification: [], team: [], userGroup: [] },

  filters(context) {
    const revenue = REVENUE_VIEWS.has(context.tab);
    const reference = context.data.reference || {};
    const byTitle = (entries) => entries
      .filter(([, title]) => title)
      .sort((first, second) => first[1].localeCompare(second[1], 'pt-BR'))
      .map(([value, label]) => ({ value, label }));

    const classifications = [...new Set([...context.data.meetings, ...context.data.tasks].map((item) => item.classification).filter(Boolean))]
      .sort((first, second) => String(first).localeCompare(String(second), 'pt-BR', { numeric: true }));

    const teams = byTitle(Object.entries(reference.teams || {}));
    const groups = byTitle(Object.entries(reference.userGroups || {}));

    // Só os status que existem na carteira entram na lista, na ordem declarada.
    const statuses = new Set(Object.values(context.data.customers || {}).map((customer) => customer.status).filter(Boolean));

    return [
      {
        id: 'status',
        label: 'Status do cliente',
        placeholder: 'Todos os status',
        disabled: statuses.size === 0,
        options: CUSTOMER_STATUS.filter((item) => statuses.has(item.value))
      },
      {
        id: 'classification',
        label: 'Classificação',
        placeholder: 'Todas as classificações',
        disabled: classifications.length === 0,
        options: classifications.map((item) => ({ value: item, label: String(item) }))
      },
      {
        // Sem opção nenhuma, o filtro se esvazia sozinho ao entrar numa aba de
        // recebimento — e o rótulo diz por quê.
        id: 'team',
        // Enquanto a passada de enriquecimento não termina, parte das linhas em cache
        // ainda não tem o vínculo com o time e o filtro sub-reporta.
        label: revenue ? 'Time · não se aplica a recebimento' : (context.fieldsReady ? 'Time' : 'Time · atualizando, resultado parcial'),
        placeholder: 'Todos os times',
        disabled: revenue || teams.length === 0,
        options: revenue ? [] : teams
      },
      {
        id: 'userGroup',
        label: revenue ? 'Grupo de Usuário · não se aplica a recebimento' : 'Grupo de Usuário',
        placeholder: 'Todos os grupos',
        disabled: revenue || groups.length === 0,
        options: revenue ? [] : groups
      }
    ];
  },

  // As abas de R$ dependem de um arquivo importado, não da sincronização. Mostrar
  // "R$ 0" em toda a coluna enquanto o relatório não chega é pior do que a tela
  // vazia: zero tem cara de número apurado.
  isEmpty(context) {
    if (REVENUE_VIEWS.has(context.tab)) return !(context.data.receipts || []).length;
    return !context.data.meetings.length && !context.data.tasks.length;
  },

  emptyMessage(context) {
    if (REVENUE_VIEWS.has(context.tab)) {
      return 'Importe o relatório de recebimentos na engrenagem para preencher esta aba. Sincronizar com o Hub não resolve: a API não expõe o financeiro.';
    }
    return context.syncing ? context.syncingMessage : 'Sincronize com o Hub na engrenagem para montar a matriz por cliente.';
  },

  rows(tab, months, context) {
    const index = buildIndex(context, tab);
    const customers = context.data.customers || {};
    const valueOf = (client, month, field) => index.get(client)?.get(month)?.[field] || 0;
    const sumOver = (client, range, field) => range.reduce((total, month) => total + valueOf(client, month, field), 0);

    // Ordenação pela coluna do ano corrente, maior primeiro, como no relatório modelo.
    // Ela segue o modo escolhido: com a coluna mostrando média, ordenar por soma
    // deixaria a primeira linha da tabela menor que a segunda.
    const currentYear = months.length ? months[months.length - 1].split('-')[0] : '';
    const currentMonths = months.filter((month) => month.startsWith(currentYear));
    const overRange = (client, range, field) => {
      if (context.periodMode !== 'average') return sumOver(client, range, field);
      const values = range.map((month) => valueOf(client, month, field)).filter((value) => value !== 0);
      return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
    };
    const ranking = (client) => {
      if (tab === 'revenuePerHour') {
        const hours = overRange(client, currentMonths, 'hours');
        return hours ? overRange(client, currentMonths, 'revenue') / hours : 0;
      }
      if (tab === 'revenue') return overRange(client, currentMonths, 'revenue');
      if (tab === 'people') return overRange(client, currentMonths, 'people');
      if (tab === 'meetings') return overRange(client, currentMonths, 'meetings');
      return overRange(client, currentMonths, 'hours');
    };

    const metric = TAB_METRIC[tab] || 'hours';
    const clients = [...index.keys()]
      .filter((client) => months.some((month) => valueOf(client, month, metric)))
      .sort((first, second) => ranking(second) - ranking(first));

    const label = (client) => customers[client]?.name || `Cliente ${client}`;

    if (tab === 'duration') return clients.map((client) => ({
      label: label(client),
      value: (month) => valueOf(client, month, 'hours'),
      format: formatClock
    }));

    if (tab === 'meetings') return clients.map((client) => ({
      label: label(client),
      value: (month) => valueOf(client, month, 'meetings'),
      format: (value) => formatNumber(value)
    }));

    if (tab === 'people') return clients.map((client) => ({
      label: label(client),
      value: (month) => valueOf(client, month, 'people'),
      format: (value) => formatNumber(value)
    }));

    if (tab === 'revenue') return clients.map((client) => ({
      label: label(client),
      value: (month) => valueOf(client, month, 'revenue'),
      format: formatCurrency
    }));

    // Razão dos totais do período: somar razões mensais daria um número sem sentido.
    return clients.map((client) => ({
      label: label(client),
      value: (month) => {
        const hours = valueOf(client, month, 'hours');
        return hours ? valueOf(client, month, 'revenue') / hours : 0;
      },
      total: (range) => {
        const hours = sumOver(client, range, 'hours');
        return hours ? sumOver(client, range, 'revenue') / hours : 0;
      },
      format: (value) => (value ? formatCurrency(value) : '–')
    }));
  },

  details(context) {
    const summary = 'Conferência da importação de recebimentos';
    if (!(context.data.receipts || []).length) {
      return { summary, content: '<p class="muted">Nenhum relatório de recebimentos importado ainda.</p>' };
    }

    const { matched, orphans, outOfScope } = resolveReceipts(context);
    const total = (list) => list.reduce((sum, item) => sum + (item.amount || 0), 0);
    const parcelas = (count) => `${formatNumber(count)} ${count === 1 ? 'parcela' : 'parcelas'}`;
    const line = (label, list) => `<span class="status-row"><b>${label} · ${parcelas(list.length)}</b><strong>${formatCurrency(total(list))}</strong></span>`;

    // "Importado", não "na matriz": o painel confere o arquivo, e o que a matriz
    // mostra ainda passa pelos filtros de status e classificação.
    const content = [
      line(`Importado · ${RECEIPT_SCOPE}`, matched),
      outOfScope.length ? line('Fora do escopo · outros centros de custo', outOfScope) : '',
      orphans.length ? line('Sem cliente correspondente', orphans) : ''
    ].join('');

    const nomes = [...new Set(orphans.map((receipt) => receipt.client).filter(Boolean))].slice(0, 12);
    const nota = orphans.length
      ? `<p class="muted">Não casaram pelo nome: ${nomes.join(', ')}${orphans.length > nomes.length ? '…' : ''}</p>`
      : '<p class="muted">Todo recebimento de consultoria casou com um cliente do Hub.</p>';

    return { summary: orphans.length ? `${summary}: ${parcelas(orphans.length)} sem cliente` : summary, content: content + nota };
  }
};
