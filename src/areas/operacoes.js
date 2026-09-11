import { formatNumber, formatCurrency, formatHours, formatPercent, formatDecimal } from '../lib/format.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20.5V10M9.8 20.5V4M16.1 20.5v-8M22.4 20.5v-5"/></svg>';

const meetingStatuses = new Set(['Previsto', 'Agendado', 'Enviado', 'Iniciado', 'Finalizado']);
const taskStatuses = new Set(['Previsto', 'Enviado', 'Pendente', 'Iniciado', 'Pausado', 'Finalizado']);

function dateIsExcluded(date, excludedDates) {
  const day = date.getDay();
  return day === 0 || day === 6 || excludedDates.has(date.toISOString().slice(0, 10));
}

function workingHours(month, excludedDates) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  let hours = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthNumber - 1, day);
    if (!dateIsExcluded(date, excludedDates)) hours += date.getDay() === 5 ? 8 : 9;
  }
  return hours;
}

function workingDays(month, excludedDates) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  let days = 0;
  for (let day = 1; day <= lastDay; day += 1) if (!dateIsExcluded(new Date(year, monthNumber - 1, day), excludedDates)) days += 1;
  return days;
}

function unique(items, key) {
  return new Set(items.map((item) => item[key]).filter(Boolean)).size;
}

/** Reuniões trazem vários participantes por registro, então a contagem percorre os arrays. */
function uniquePeople(items) {
  const people = new Set();
  items.forEach((item) => {
    const list = item.people?.length ? item.people : (item.participant ? [item.participant] : []);
    list.forEach((person) => people.add(person));
  });
  return people.size;
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

/** Nada escolhido é "tudo": é como o filtro começa e é o que o campo mostra. */
const chosen = (selected, value) => !selected?.length || selected.includes(value);

function filteredData(context, kind) {
  const { data, month, filters } = context;
  const source = data[kind].filter((item) => item.month && (kind !== 'payments' ? item.status === 'Finalizado' : item.paid));
  return source.filter((item) => (kind === 'payments' || chosen(filters.classification, item.classification)) && (month === 'all' || item.month === month));
}

function metricsFor(context, month) {
  const { filters, excludedDates } = context;
  const meetings = filteredData(context, 'meetings').filter((item) => item.month === month);
  const tasks = filteredData(context, 'tasks').filter((item) => item.month === month);
  const payments = filteredData(context, 'payments').filter((item) => item.month === month);
  // A reunião é o trabalho voltado para fora e a tarefa o de dentro, então a Visão
  // escolhe qual dos dois entra. Com as duas marcadas, ou nenhuma, entram as duas.
  const selectedMeetings = chosen(filters.segment, 'external') ? distinctActivities(meetings) : [];
  const selectedTasks = chosen(filters.segment, 'internal') ? distinctActivities(tasks) : [];
  const activities = [...selectedMeetings, ...selectedTasks];
  const capacity = workingHours(month, excludedDates);
  const minutes = activities.reduce((sum, item) => sum + item.minutes, 0);
  const costByPlan = payments.reduce((plans, item) => {
    const plan = item.account || 'Sem plano de contas';
    plans[plan] = (plans[plan] || 0) + item.amount;
    return plans;
  }, {});
  return {
    meetings: selectedMeetings,
    tasks: selectedTasks,
    payments,
    activities,
    capacity,
    minutes,
    clients: unique(activities, 'client'),
    people: uniquePeople(activities),
    cost: payments.reduce((sum, item) => sum + item.amount, 0),
    costByPlan
  };
}

/** Atividades de um conjunto de meses, para as contagens de distintos do período. */
function activitiesOver(context, months) {
  return months.flatMap((month) => metricsFor(context, month).activities);
}

function statusPool(context) {
  return [...context.data.meetings, ...context.data.tasks];
}

export const operacoes = {
  id: 'operacoes',
  path: '/operacoes',
  label: 'Operações',
  icon: ICON,
  title: 'Indicadores Operacionais',
  subtitle: 'Linha do tempo mensal de reuniões, tarefas, capacidade, qualidade e custos pagos.',
  eyebrow: 'CONSELHO FORMATAR / GESTÃO',

  tabs: [
    { id: 'volume', label: 'Volume' },
    { id: 'productivity', label: 'Produtividade' },
    { id: 'cost', label: 'Custo' },
    { id: 'quality', label: 'Qualidade' }
  ],

  defaultFilters: { segment: [], classification: [] },

  filters(context) {
    const classifications = [...new Set([...context.data.meetings, ...context.data.tasks].map((item) => item.classification).filter(Boolean))]
      .sort((first, second) => String(first).localeCompare(String(second), 'pt-BR', { numeric: true }));
    return [
      {
        id: 'segment',
        label: 'Visão',
        placeholder: 'Todas',
        options: [
          { value: 'internal', label: 'Internos' },
          { value: 'external', label: 'Externos' }
        ]
      },
      {
        id: 'classification',
        label: 'Classificação do cliente',
        placeholder: 'Todas as classificações',
        disabled: classifications.length === 0,
        options: classifications.map((item) => ({ value: item, label: String(item) }))
      }
    ];
  },

  isEmpty: (context) => !context.data.meetings.length && !context.data.tasks.length,
  emptyMessage: 'Sincronize com o Hub na engrenagem para visualizar a linha do tempo.',

  rows(tab, months, context) {
    const metric = (month) => metricsFor(context, month);
    const totalActivities = (month) => metric(month).activities.length;
    const average = (month, selector) => {
      const items = selector(metric(month));
      return items.length ? items.reduce((sum, item) => sum + item.minutes, 0) / items.length / 60 : 0;
    };
    const number = (value) => formatNumber(value);

    if (tab === 'volume') return [
      { label: 'Atividades finalizadas, em qtde', value: totalActivities, format: number },
      { label: 'Reuniões realizadas, em qtde', value: (month) => metric(month).meetings.length, format: number },
      { label: 'Tarefas realizadas, em qtde', value: (month) => metric(month).tasks.length, format: number },
      { label: 'Atividades realizadas, em horas', value: (month) => metric(month).minutes / 60, format: formatHours },
      {
        label: 'Clientes atendidos, em qtde',
        value: (month) => metric(month).clients,
        total: (range) => unique(activitiesOver(context, range), 'client'),
        format: number
      },
      {
        label: 'Responsáveis e participantes distintos',
        value: (month) => metric(month).people,
        total: (range) => uniquePeople(activitiesOver(context, range)),
        format: number
      },
      { label: 'Dias úteis do mês, em qtde', value: (month) => workingDays(month, context.excludedDates), format: number },
      { label: 'Tempo de trabalho disponível, em HH/mês', value: (month) => metric(month).capacity, format: formatHours }
    ];

    if (tab === 'productivity') return [
      { label: 'Tempo de trabalho disponível, em HH/mês', value: (month) => metric(month).capacity, format: formatHours },
      { label: 'Horas apontadas, em HH', value: (month) => metric(month).minutes / 60, format: formatHours },
      { label: 'Ocupação do tempo disponível, em %', value: (month) => metric(month).capacity ? metric(month).minutes / 60 / metric(month).capacity * 100 : 0, format: formatPercent, aggregate: 'average' },
      { label: 'Tempo médio das reuniões, em horas', value: (month) => average(month, (current) => current.meetings), format: formatHours, aggregate: 'average' },
      { label: 'Tempo médio das tarefas, em horas', value: (month) => average(month, (current) => current.tasks), format: formatHours, aggregate: 'average' },
      { label: 'Atividades, em qtde/cliente/mês', value: (month) => metric(month).clients ? totalActivities(month) / metric(month).clients : 0, format: formatDecimal, aggregate: 'average' },
      { label: 'Atividades, em qtde/dia', value: (month) => workingDays(month, context.excludedDates) ? totalActivities(month) / workingDays(month, context.excludedDates) : 0, format: formatDecimal, aggregate: 'average' },
      { label: 'Atividades, em qtde/dia/pessoa', value: (month) => workingDays(month, context.excludedDates) && metric(month).people ? totalActivities(month) / workingDays(month, context.excludedDates) / metric(month).people : 0, format: formatDecimal, aggregate: 'average' }
    ];

    if (tab === 'cost') return [
      { label: 'Custos totais pagos, em R$', value: (month) => metric(month).cost, format: formatCurrency },
      { label: 'Custo por hora de atividade, em R$', value: (month) => metric(month).minutes ? metric(month).cost / (metric(month).minutes / 60) : 0, format: formatCurrency, aggregate: 'average' },
      { label: 'Custo por atividade finalizada, em R$', value: (month) => totalActivities(month) ? metric(month).cost / totalActivities(month) : 0, format: formatCurrency, aggregate: 'average' },
      ...[...new Set(months.flatMap((month) => Object.keys(metric(month).costByPlan)))].sort().map((plan) => ({
        label: `Plano · ${plan}`,
        value: (month) => metric(month).costByPlan[plan] || 0,
        format: formatCurrency
      }))
    ];

    const statusRows = statusPool(context).map((item) => item.status).filter(Boolean)
      .filter((status, index, statuses) => statuses.indexOf(status) === index).sort();

    return [
      { label: 'Atividades finalizadas, em qtde', value: totalActivities, format: number },
      { label: 'Atividades canceladas, em qtde', value: (month) => statusPool(context).filter((item) => item.month === month && item.status.toLowerCase().includes('cancel')).length, format: number },
      {
        label: 'Taxa de conclusão, em %',
        value: (month) => {
          const all = statusPool(context).filter((item) => item.month === month);
          return all.length ? all.filter((item) => item.status === 'Finalizado').length / all.length * 100 : 0;
        },
        format: formatPercent,
        aggregate: 'average'
      },
      ...statusRows.map((status) => ({
        label: `Status · ${status}`,
        value: (month) => statusPool(context).filter((item) => item.month === month && item.status === status).length,
        format: number
      }))
    ];
  },

  details(context) {
    const pool = statusPool(context);
    const cancellations = pool.filter((item) => item.status.toLowerCase().includes('cancel')).reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {});
    const ignored = pool.filter((item) => item.status && item.status !== 'Finalizado' && !meetingStatuses.has(item.status) && !taskStatuses.has(item.status)).length;
    const entries = Object.entries(cancellations);
    return {
      summary: 'Detalhes de status cancelados e registros desconsiderados',
      content: entries.length
        ? `${entries.map(([status, count]) => `<span class="status-row"><b>${status}</b><strong>${formatNumber(count)}</strong></span>`).join('')}<span class="status-row"><b>Registros com status não mapeado</b><strong>${formatNumber(ignored)}</strong></span>`
        : '<p class="muted">Nenhum cancelamento carregado.</p>'
    };
  }
};
