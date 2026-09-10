const THEME_KEY = 'formatar-dashboard-theme';
const LOGO_BASE = { light: '/logo-preta', dark: '/logo-branca' };
const CANVAS = { light: '#f3f3f3', dark: '#0d0d0d' };

export function preferredTheme() {
  const saved = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  })();
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * A logo aponta para os PNGs oficiais e cai para o SVG provisório caso o arquivo
 * não exista, então basta colocar `logo-branca.png` e `logo-preta.png` em `public/`.
 */
function applyLogo(theme) {
  const logo = document.querySelector('#brand-logo');
  if (!logo) return;
  logo.dataset.fallback = 'pending';
  logo.src = `${LOGO_BASE[theme]}.png`;
}

function bindLogoFallback() {
  const logo = document.querySelector('#brand-logo');
  if (!logo) return;
  logo.addEventListener('error', () => {
    if (logo.dataset.fallback === 'done') return;
    logo.dataset.fallback = 'done';
    logo.src = logo.src.replace(/\.png(\?.*)?$/, '.svg');
  });
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CANVAS[theme]);
  const toggle = document.querySelector('#theme-toggle');
  if (toggle) {
    const next = theme === 'dark' ? 'claro' : 'escuro';
    toggle.setAttribute('aria-label', `Alternar para tema ${next}`);
    toggle.title = `Alternar para tema ${next}`;
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  }
  applyLogo(theme);
}

export function initTheme(onChange) {
  bindLogoFallback();
  let theme = preferredTheme();
  applyTheme(theme);

  document.querySelector('#theme-toggle')?.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A preferência é conveniência local; o tema continua funcionando na sessão.
    }
    applyTheme(theme);
    onChange?.(theme);
  });

  return theme;
}
