const UPSTREAM = 'https://hub.formatar.com.br/v1';
const ALLOWED_RESOURCES = new Set(['meetings', 'tasks', 'customers']);
const RATE_LIMIT_HEADERS = ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy', 'retry-after'];

function problem(status, type, message) {
  return new Response(JSON.stringify({ status, type, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/** A secret key é guardada crua no ambiente; o prefixo `Bearer` é montado aqui. */
function secretKey(env) {
  return String(env?.HUB_API_SECRET_KEY || '').replace(/^Bearer\s+/i, '').trim();
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET') {
    return problem(405, 'METHOD_NOT_ALLOWED', 'Este proxy aceita apenas requisições GET.');
  }

  const segments = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
  const resource = segments[0] === 'v1' ? segments.slice(1) : segments;

  if (resource.length !== 1 || !ALLOWED_RESOURCES.has(resource[0])) {
    return problem(404, 'NOT_FOUND', 'Recurso não habilitado neste proxy.');
  }

  const key = secretKey(env);
  if (!key) {
    return problem(503, 'MISSING_API_KEY', 'A secret key não está configurada no ambiente do Cloudflare Pages.');
  }

  const target = new URL(`${UPSTREAM}/${resource[0]}`);
  target.search = new URL(request.url).search;

  const upstream = await fetch(target, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' }
  });

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');

  // A API limita a 50 requisicoes por minuto e uma carga completa passa de 780
  // paginas. Sem repassar estes headers o navegador nao sabe quanto falta para a
  // janela reabrir e so consegue tentar as cegas.
  RATE_LIMIT_HEADERS.forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  });

  return new Response(upstream.body, { status: upstream.status, headers });
}
