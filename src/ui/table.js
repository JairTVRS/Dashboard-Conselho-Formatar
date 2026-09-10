import { monthLabel, shortMonth } from '../lib/dates.js';
import { formatNumber } from '../lib/format.js';

export function comparisonPeriod(months) {
  const endMonth = Number(months[months.length - 1].split('-')[1]);
  const currentYear = Number(months[months.length - 1].split('-')[0]);
  const previousYear = currentYear - 1;
  const range = (year) => months.filter((month) => Number(month.split('-')[0]) === year && Number(month.split('-')[1]) <= endMonth);
  return {
    endMonth,
    currentMonths: range(currentYear),
    previousMonths: range(previousYear),
    previousLabel: `jan/${String(previousYear).slice(-2)} a ${shortMonth(endMonth)}/${String(previousYear).slice(-2)}`,
    currentLabel: `jan/${String(currentYear).slice(-2)} a ${shortMonth(endMonth)}/${String(currentYear).slice(-2)}`
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

export function tableMarkup(rows, visibleMonths) {
  const comparison = comparisonPeriod(visibleMonths);
  const head = `<thead><tr><th>Indicador</th><th>${comparison.previousLabel}</th><th>${comparison.currentLabel}</th><th>Variação</th>${visibleMonths.map((month) => `<th>${monthLabel(month)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((row) => {
    const previous = accumulated(row, comparison.previousMonths, comparison.endMonth);
    const current = accumulated(row, comparison.currentMonths, comparison.endMonth);
    const variation = previous ? (current / previous - 1) * 100 : null;
    const cells = visibleMonths.map((month) => `<td>${row.format(row.value(month))}</td>`).join('');
    return `<tr><th>${row.label}</th><td>${row.format(previous)}</td><td>${row.format(current)}</td><td class="variation-cell ${variationClass(variation)}">${variation === null ? '-' : `${formatNumber(variation, 2)}%`}</td>${cells}</tr>`;
  }).join('');
  return `<table class="indicator-table">${head}<tbody>${body}</tbody></table>`;
}
