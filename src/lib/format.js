export function formatNumber(number, digits = 0) {
  return Number(number || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function formatHours(value) {
  return `${formatNumber(value, 1)} h`;
}

export function formatPercent(value) {
  return `${formatNumber(value, 1)}%`;
}

export function formatDecimal(value) {
  return formatNumber(value, 1);
}
