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

/** Duração no formato do relatório comercial: 261:33 são 261 horas e 33 minutos. */
export function formatClock(hours) {
  const value = Number(hours) || 0;
  const minutes = Math.round(Math.abs(value) * 60);
  return `${value < 0 ? '-' : ''}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
