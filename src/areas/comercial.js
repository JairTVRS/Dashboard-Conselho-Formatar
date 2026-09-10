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
 * Casa cada pagamento com um cliente: primeiro pelo nid, que é exato; o que sobrar
 * tenta pelo nome normalizado. O que não casar é contado, nunca descartado em
 * silêncio — aparece no detalhe da área.
 */
function resolvePayments(context) {
  const customers = context.data.customers || {};
  const byNid = {};
  const byName = {};
  Object.entries(customers).forEach(([id, customer]) => {
    if (customer.nid) byNid[String(customer.nid)] = id;
    const key = nameKey(customer.name);
    if (key && !byName[key]) byName[key] = id;
  });

  const matched = [];
  const orphans = [];
  (context.data.payments || []).forEach((payment) => {
    if (!payment.paid || !payment.month) return;
    const id = byNid[String(payment.nid || '').trim()] || byName[nameKey(payment.client)] || '';
    if (id) matched.push({ ...payment, client: id });
    else orphans.push(payment);
  });
  return { matched, orphans };
}

function teamsOf(item, reference) {
  if (item.team) return [item.team];
  return reference.meetingTypeTeams?.[item.meetingType] || [];
}

/** Filtros ativos, já considerando que as visões de recebimento ignoram time e grupo. */
function activeFilters(context, tab) {
  const filters = context.filters || {};
  const revenue = REVENUE_VIEWS.has(tab);
  return {
    classification: filters.classification || 'all',
    team: revenue ? 'all' : (filters.team || 'all'),
    userGroup: revenue ? 'all' : (filters.userGroup || 'all')
  };
}

function selectedActivities(context, tab) {
  const reference = context.data.reference || {};
  const { classification, team, userGroup } = activeFilters(context, tab);

  return [...context.data.meetings, ...context.data.tasks].filter((item) => {
    if (item.status !== 'Finalizado' || !item.month || !item.client) return false;
    if (classification !== 'all' && item.classification !== classification) return false;
    if (team !== 'all' && !teamsOf(item, reference).includes(team)) return false;
    if (userGroup !== 'all' && !item.people.some((person) => reference.userGroupOf?.[person] === userGroup)) return false;
    return true;
  });
}

/**
 * A duração conta inteira — não se reparte uma reunião de uma hora entre times.
 * Já a contagem de participantes respeita o filtro: com o grupo "Consultores"
 * ativo, uma reunião de três pessoas soma só os consultores presentes.
 */
function peopleIn(item, context, tab) {
  const { userGroup } = activeFilters(context, tab);
  if (userGroup === 'all') return item.people.length;
  const reference = context.data.reference || {};
  return item.people.filter((person) => reference.userGroupOf?.[person] === userGroup).length;
}

function buildIndex(context, tab) {
  const index = new Map();
  const cell = (client, month) => {
    if (!index.has(client)) index.set(client, new Map());
    const months = index.get(client);
    if (!months.has(month)) months.set(month, { hours: 0, people: 0, revenue: 0 });
    return months.get(month);
  };

  selectedActivities(context, tab).forEach((item) => {
    const entry = cell(item.client, item.month);
    entry.hours += (item.minutes || 0) / 60;
    entry.people += peopleIn(item, context, tab);
  });

  const { matched, orphans } = resolvePayments(context);
  const { classification } = activeFilters(context, tab);
  matched.forEach((payment) => {
    if (classification !== 'all' && (context.data.classifications?.[payment.client] || '') !== classification) return;
    cell(payment.client, payment.month).revenue += payment.amount || 0;
  });

  return { index, orphans };
}

export const comercial = {
  id: 'comercial',
  path: '/comercial',
  label: 'Comercial',
  icon: ICON,
  title: 'Indicadores Comerciais',
  subtitle: 'Matriz mensal por cliente de duração, participantes e recebimento das atividades finalizadas.',
  eyebrow: 'CONSELHO FORMATAR / GESTÃO',

  tabs: [
    { id: 'duration', label: 'Tempo de duração' },
    { id: 'people', label: 'Qtd de participantes' },
    { id: 'revenue', label: 'Recebimento' },
    { id: 'revenuePerHour', label: 'Recebimento por hora' }
  ],

  labelHeader: 'Cliente',
  defaultFilters: { classification: 'all', team: 'all', userGroup: 'all' },

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

    return [
      {
        id: 'classification',
        label: 'Classificação',
        disabled: classifications.length === 0,
        options: [{ value: 'all', label: 'Todas as classificações' }, ...classifications.map((item) => ({ value: item, label: String(item) }))]
      },
      {
        // Sem opção além de "todos", o filtro se reseta sozinho ao entrar numa aba
        // de recebimento — e o rótulo diz por quê.
        id: 'team',
        // Enquanto a passada de enriquecimento não termina, parte das linhas em cache
        // ainda não tem o vínculo com o time e o filtro sub-reporta.
        label: revenue ? 'Time · não se aplica a recebimento' : (context.fieldsReady ? 'Time' : 'Time · atualizando, resultado parcial'),
        disabled: revenue || teams.length === 0,
        options: revenue ? [{ value: 'all', label: 'Todos os times' }] : [{ value: 'all', label: 'Todos os times' }, ...teams]
      },
      {
        id: 'userGroup',
        label: revenue ? 'Grupo de Usuário · não se aplica a recebimento' : 'Grupo de Usuário',
        disabled: revenue || groups.length === 0,
        options: revenue ? [{ value: 'all', label: 'Todos os grupos' }] : [{ value: 'all', label: 'Todos os grupos' }, ...groups]
      }
    ];
  },

  isEmpty: (context) => !context.data.meetings.length && !context.data.tasks.length && !context.data.payments.length,
  emptyMessage: 'Sincronize com o Hub na engrenagem para montar a matriz por cliente.',

  rows(tab, months, context) {
    const { index } = buildIndex(context, tab);
    const customers = context.data.customers || {};
    const valueOf = (client, month, field) => index.get(client)?.get(month)?.[field] || 0;
    const sumOver = (client, range, field) => range.reduce((total, month) => total + valueOf(client, month, field), 0);

    // Ordenação pela coluna do ano corrente, maior primeiro, como no relatório modelo.
    const currentYear = months.length ? months[months.length - 1].split('-')[0] : '';
    const currentMonths = months.filter((month) => month.startsWith(currentYear));
    const ranking = (client) => {
      if (tab === 'revenuePerHour') {
        const hours = sumOver(client, currentMonths, 'hours');
        return hours ? sumOver(client, currentMonths, 'revenue') / hours : 0;
      }
      if (tab === 'revenue') return sumOver(client, currentMonths, 'revenue');
      if (tab === 'people') return sumOver(client, currentMonths, 'people');
      return sumOver(client, currentMonths, 'hours');
    };

    const clients = [...index.keys()]
      .filter((client) => months.some((month) => {
        const entry = index.get(client)?.get(month);
        return entry && (entry.hours || entry.people || entry.revenue);
      }))
      .sort((first, second) => ranking(second) - ranking(first));

    const label = (client) => customers[client]?.name || `Cliente ${client}`;

    if (tab === 'duration') return clients.map((client) => ({
      label: label(client),
      value: (month) => valueOf(client, month, 'hours'),
      format: formatClock
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
    const { orphans } = resolvePayments(context);
    if (!(context.data.payments || []).length) {
      return {
        summary: 'Conferência da importação de pagamentos',
        content: '<p class="muted">Nenhum relatório de pagamentos importado ainda.</p>'
      };
    }
    if (!orphans.length) {
      return {
        summary: 'Conferência da importação de pagamentos',
        content: '<p class="muted">Todos os pagamentos importados casaram com um cliente do Hub.</p>'
      };
    }
    const total = orphans.reduce((sum, payment) => sum + (payment.amount || 0), 0);
    const nomes = [...new Set(orphans.map((payment) => payment.client).filter(Boolean))].slice(0, 12);
    return {
      summary: `Pagamentos sem cliente correspondente: ${formatNumber(orphans.length)}`,
      content: `<span class="status-row"><b>Valor fora da matriz</b><strong>${formatCurrency(total)}</strong></span>`
        + `<p class="muted">Não casaram nem por nid nem por nome: ${nomes.join(', ')}${orphans.length > nomes.length ? '…' : ''}</p>`
    };
  }
};
