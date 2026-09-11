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
 * Ordena pela coluna escolhida. Linhas sem valor comparável — a variação de quem não
 * tinha movimento no ano anterior — vão sempre para o fim, nos dois sentidos: elas
 * não são "as menores", são as que não têm resposta.
 */
function sortEntries(entries, sort) {
  if (!sort?.column) return entries;
  const factor = sort.direction === 'asc' ? 1 : -1;
  const valueOf = (entry) => {
    if (sort.column === 'label') return entry.row.label;
    if (sort.column === 'previous') return entry.previous;
    if (sort.column === 'current') return entry.current;
    if (sort.column === 'variation') return entry.variation;
    return entry.row.value(sort.column);
  };

  return [...entries].sort((first, second) => {
    const left = valueOf(first);
    const right = valueOf(second);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === 'string') return left.localeCompare(right, 'pt-BR') * factor;
    return (left - right) * factor;
  });
}

/** Cabeçalho clicável, com a seta só na coluna que está ordenando. */
function headCell(className, label, column, sort) {
  const active = sort?.column === column;
  const arrow = active ? `<span class="sort-arrow">${sort.direction === 'asc' ? '▲' : '▼'}</span>` : '';
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th class="${className} is-sortable${active ? ' is-sorted' : ''}" data-sort-column="${column}" aria-sort="${ariaSort}" tabindex="0" role="button" title="Ordenar por ${label}">${label}${arrow}</th>`;
}

/**
 * As colunas levam classe própria em vez de serem pintadas por posição: quando a
 * comparação está oculta, as colunas de mês assumem a posição das que sumiram e
 * herdariam o cinza do acumulado e o laranja da variação.
 */
export function tableMarkup(rows, visibleMonths, labelHeader = 'Indicador', sort = null) {
  const comparison = comparisonPeriod(visibleMonths);
  const previousHead = comparison.comparable ? headCell('col-previous', comparison.previousLabel, 'previous', sort) : '';
  const variationHead = comparison.comparable ? headCell('col-variation', 'Variação', 'variation', sort) : '';
  const monthHeads = visibleMonths.map((month) => headCell('col-month', monthLabel(month), month, sort)).join('');
  const head = `<thead><tr>${headCell('col-label', labelHeader, 'label', sort)}${previousHead}${headCell('col-current', comparison.currentLabel, 'current', sort)}${variationHead}${monthHeads}</tr></thead>`;

  const entries = rows.map((row) => {
    const current = accumulated(row, comparison.currentMonths, comparison.endMonth);
    const previous = comparison.comparable ? accumulated(row, comparison.previousMonths, comparison.endMonth) : 0;
    return { row, current, previous, variation: comparison.comparable && previous ? (current / previous - 1) * 100 : null };
  });

  const body = sortEntries(entries, sort).map(({ row, current, previous, variation }) => {
    const cells = visibleMonths.map((month) => `<td class="col-month">${row.format(row.value(month))}</td>`).join('');
    if (!comparison.comparable) {
      return `<tr><th class="col-label">${row.label}</th><td class="col-current">${row.format(current)}</td>${cells}</tr>`;
    }
    return `<tr><th class="col-label">${row.label}</th><td class="col-previous">${row.format(previous)}</td><td class="col-current">${row.format(current)}</td><td class="col-variation variation-cell ${variationClass(variation)}">${variation === null ? '-' : `${formatNumber(variation, 2)}%`}</td>${cells}</tr>`;
  }).join('');

  return `<table class="indicator-table${comparison.comparable ? '' : ' without-comparison'}">${head}<tbody>${body}</tbody></table>`;
}
