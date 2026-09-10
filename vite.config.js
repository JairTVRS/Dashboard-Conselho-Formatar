import { defineConfig, loadEnv } from 'vite';

const UPSTREAM = 'https://hub.formatar.com.br';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const secret = String(env.HUB_API_SECRET_KEY || env.Authorization || '').replace(/^Bearer\s+/i, '').trim();

  return {
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
