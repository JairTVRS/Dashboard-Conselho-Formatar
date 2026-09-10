import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

const UPSTREAM = 'https://hub.formatar.com.br';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const secret = String(env.HUB_API_SECRET_KEY || env.Authorization || '').replace(/^Bearer\s+/i, '').trim();

  return {
    // A versão exibida no cabeçalho vem do package.json, então nunca diverge do source.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: {
      proxy: {
        '/api/v1': {
          target: UPSTREAM,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyRequest) => {
              if (secret) proxyRequest.setHeader('x-secret-key', secret);
            });
          }
        }
      }
    }
  };
});
