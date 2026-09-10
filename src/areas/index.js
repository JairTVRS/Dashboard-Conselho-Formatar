import { operacoes } from './operacoes.js';
import { comercial } from './comercial.js';

const ICONS = {
  comercial: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h18l-7 8.2v6.4l-4 2.4v-8.8Z"/></svg>',
  rh: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0"/></svg>',
  financeiro: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8v18.4"/><path d="M16.4 6.6H9.8a2.9 2.9 0 0 0 0 5.8h4.4a2.9 2.9 0 0 1 0 5.8H7.2"/></svg>'
};

/** Área ainda sem fonte de dados definida: exibe apenas título e aviso. */
function pending({ id, label, title, subtitle }) {
  return {
    id,
    path: `/${id}`,
    label,
    icon: ICONS[id],
    title,
    subtitle,
    eyebrow: 'CONSELHO FORMATAR / GESTÃO',
    tabs: [],
    defaultFilters: {},
    filters: () => [],
    isEmpty: () => true,
    emptyMessage: 'Fonte de dados ainda não configurada para esta área.',
    rows: () => [],
    details: () => null,
    pending: true
  };
}

/** A ordem deste array é a ordem exibida na navegação lateral. */
export const areas = [
  pending({
    id: 'rh',
    label: 'RH',
    title: 'Indicadores de RH',
    subtitle: 'Linha do tempo mensal de quadro, movimentação, absenteísmo e custo de pessoal.'
  }),
  operacoes,
  comercial,
  pending({
    id: 'financeiro',
    label: 'Financeiro',
    title: 'Indicadores Financeiros',
    subtitle: 'Linha do tempo mensal de receita, despesas, margem e fluxo de caixa.'
  })
];

export const defaultArea = operacoes;

export function areaByPath(pathname) {
  const normalized = `/${String(pathname || '').split('/').filter(Boolean)[0] || ''}`;
  return areas.find((area) => area.path === normalized) || defaultArea;
}

export function areaById(id) {
  return areas.find((area) => area.id === id) || defaultArea;
}
