const UPSTREAM = 'https://hub.formatar.com.br/v1';
const ALLOWED_RESOURCES = new Set(['meetings', 'tasks', 'customers']);

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

  return new Response(upstream.body, { status: upstream.status, headers });
}
