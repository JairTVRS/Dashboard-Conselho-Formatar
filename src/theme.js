const THEME_KEY = 'formatar-dashboard-theme';
const LOGO = { light: '/logo-preta.png', dark: '/logo-branca.png' };
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

function applyLogo(theme) {
  const logo = document.querySelector('#brand-logo');
  if (logo) logo.src = LOGO[theme];
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
