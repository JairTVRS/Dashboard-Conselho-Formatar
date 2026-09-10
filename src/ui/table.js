import { monthLabel, shortMonth } from '../lib/dates.js';
import { formatNumber } from '../lib/format.js';

/** Rótulo do que a coluna soma de fato — nunca um período fixo no código. */
function rangeLabel(months) {
  if (!months.length) return '';
  const stamp = (month) => `${shortMonth(Number(month.split('-')[1]))}/${month.split('-')[0].slice(-2)}`;
  const first = months[0];
  const last = months[months.length - 1];
  return first === last ? stamp(first) : `${stamp(first)} a ${stamp(last)}`;
}

export function comparisonPeriod(months) {
  const endMonth = Number(months[months.length - 1].split('-')[1]);
  const currentYear = Number(months[months.length - 1].split('-')[0]);
  const previousYear = currentYear - 1;
  const range = (year) => months.filter((month) => Number(month.split('-')[0]) === year && Number(month.split('-')[1]) <= endMonth);
  const currentMonths = range(currentYear);
  const previousMonths = range(previousYear);

  // Durante a carga em fases um dos anos chega antes do outro. Comparar
  // jan–set de um contra abr–set do outro produziria uma variação inventada,
  // então a comparação só aparece quando os dois lados cobrem os mesmos meses.
  const shape = (list) => list.map((month) => month.split('-')[1]).join(',');
  const comparable = previousMonths.length > 0 && shape(previousMonths) === shape(currentMonths);

  return {
    endMonth,
    currentMonths,
    previousMonths,
    comparable,
    previousLabel: rangeLabel(previousMonths),
    currentLabel: rangeLabel(currentMonths)
  };
}

/**
 * Valor das colunas acumuladas. Uma linha pode declarar:
 * - `total(months)`: calcula sobre o conjunto inteiro (contagens de distintos);
 * - `aggregate: 'average'`: média dos meses (percentuais, médias e razões);
 * - nada: soma dos meses, que é o correto para contagens e valores aditivos.
 */
export function accumulated(row, months, endMonth) {
  const scoped = months.filter((month) => Number(month.split('-')[1]) <= endMonth);
  if (!scoped.length) return 0;
  if (typeof row.total === 'function') return row.total(scoped);
  const values = scoped.map((month) => row.value(month));
  const sum = values.reduce((total, value) => total + value, 0);
  return row.aggregate === 'average' ? sum / values.length : sum;
}

export function variationClass(variation) {
  if (variation === null) return '';
  if (variation > 5) return 'variation-good';
  if (variation < -5) return 'variation-bad';
  return 'variation-neutral';
}

/**
 * As colunas levam classe própria em vez de serem pintadas por posição: quando a
 * comparação está oculta, as colunas de mês assumem a posição das que sumiram e
 * herdariam o cinza do acumulado e o laranja da variação.
 */
export function tableMarkup(rows, visibleMonths, labelHeader = 'Indicador') {
  const comparison = comparisonPeriod(visibleMonths);
  const previousHead = comparison.comparable ? `<th class="col-previous">${comparison.previousLabel}</th>` : '';
  const variationHead = comparison.comparable ? '<th class="col-variation">Variação</th>' : '';
  const monthHeads = visibleMonths.map((month) => `<th class="col-month">${monthLabel(month)}</th>`).join('');
  const head = `<thead><tr><th class="col-label">${labelHeader}</th>${previousHead}<th class="col-current">${comparison.currentLabel}</th>${variationHead}${monthHeads}</tr></thead>`;

  const body = rows.map((row) => {
    const current = accumulated(row, comparison.currentMonths, comparison.endMonth);
    const cells = visibleMonths.map((month) => `<td class="col-month">${row.format(row.value(month))}</td>`).join('');
    if (!comparison.comparable) {
      return `<tr><th class="col-label">${row.label}</th><td class="col-current">${row.format(current)}</td>${cells}</tr>`;
    }
    const previous = accumulated(row, comparison.previousMonths, comparison.endMonth);
    const variation = previous ? (current / previous - 1) * 100 : null;
    return `<tr><th class="col-label">${row.label}</th><td class="col-previous">${row.format(previous)}</td><td class="col-current">${row.format(current)}</td><td class="col-variation variation-cell ${variationClass(variation)}">${variation === null ? '-' : `${formatNumber(variation, 2)}%`}</td>${cells}</tr>`;
  }).join('');

  return `<table class="indicator-table${comparison.comparable ? '' : ' without-comparison'}">${head}<tbody>${body}</tbody></table>`;
}
