import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

const UPSTREAM = 'https://hub.formatar.com.br';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const secret = String(env.HUB_API_SECRET_KEY || '').trim().replace(/^['"]|['"]$/g, '').replace(/^Bearer\s+/i, '').trim();

  // A API recusa qualquer chamada que pareça vir de um navegador
  // (403 BROWSER_ORIGIN_NOT_ALLOWED), então o proxy precisa remover os headers
  // que denunciam a origem. A Pages Function não sofre disso porque monta uma
  // requisição nova do zero.
  const BROWSER_HEADERS = ['referer', 'origin', 'cookie', 'user-agent', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

  // Espelha em desenvolvimento o repasse que a Pages Function faz dos headers de
  // limite de requisições; sem eles o cliente não consegue se autorregular.
  const RATE_LIMIT_HEADERS = ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy', 'retry-after'];

  /** Espelha em desenvolvimento o que a Pages Function faz em produção. */
  const proxy = {
    '/api/v1': {
      target: UPSTREAM,
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
      configure: (server) => {
        server.on('proxyReq', (request) => {
          BROWSER_HEADERS.forEach((header) => request.removeHeader(header));
          request.setHeader('accept', 'application/json');
          if (secret) request.setHeader('authorization', `Bearer ${secret}`);
        });
        server.on('proxyRes', (upstream, _request, response) => {
          RATE_LIMIT_HEADERS.forEach((header) => {
            if (upstream.headers[header]) response.setHeader(header, upstream.headers[header]);
          });
        });
      }
    }
  };

  return {
    // A versão exibida no cabeçalho vem do package.json, então nunca diverge do source.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    // As áreas usam rotas próprias (/comercial, /rh, /financeiro): sem o fallback
    // para index.html, um link direto ou um F5 dentro da área daria 404 local.
    appType: 'spa',
    server: { proxy },
    preview: { proxy }
  };
});
