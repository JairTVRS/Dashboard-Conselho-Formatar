const UPSTREAM = 'https://hub.formatar.com.br/v1';
const ALLOWED_RESOURCES = new Set(['meetings', 'tasks', 'customers']);

function problem(status, type, message, extra) {
  return new Response(JSON.stringify({ status, type, message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

const KEY_NAMES = ['HUB_API_SECRET_KEY', 'Authorization', 'AUTHORIZATION'];

function secretKey(env) {
  const name = KEY_NAMES.find((candidate) => env?.[candidate]);
  return String(name ? env[name] : '').replace(/^Bearer\s+/i, '').trim();
}

/**
 * Só é usado quando a chave não foi encontrada, para distinguir "variável ausente"
 * de "variável presente com valor vazio" ou nome com caractere invisível.
 * Reporta nomes e tamanhos — nunca valores.
 */
function diagnostics(env) {
  const names = env && typeof env === 'object' ? Object.keys(env) : [];
  const strings = names.filter((name) => typeof env[name] === 'string');
  return {
    diagnostico: {
      variaveis_visiveis: names.length,
      nomes_de_texto: strings.map((name) => `${JSON.stringify(name)} (${env[name].length} caracteres)`),
      nomes_de_binding: names.filter((name) => typeof env[name] !== 'string'),
      procurando_por: KEY_NAMES
    }
  };
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
    return problem(503, 'MISSING_API_KEY', 'A secret key não está configurada no ambiente do Cloudflare Pages.', diagnostics(env));
  }

  const target = new URL(`${UPSTREAM}/${resource[0]}`);
  target.search = new URL(request.url).search;

  const upstream = await fetch(target, {
    method: 'GET',
    headers: { 'x-secret-key': key, accept: 'application/json' }
  });

  // Quando a API recusa a chave, o formato dela ajuda a separar erro de digitação
  // (colagem truncada, quebra de linha no meio) de chave realmente inativa.
  // Reporta tamanho e forma — nunca o conteúdo.
  if (upstream.status === 401 || upstream.status === 403) {
    const body = await upstream.json().catch(() => null);
    return problem(upstream.status, body?.type || 'API_KEY_REJECTED', body?.message || 'A API recusou a secret key.', {
      chave_enviada: {
        caracteres: key.length,
        tem_espaco_interno: /\s/.test(key),
        primeiros_3: key.slice(0, 3),
        formato: /^[\w-]+$/.test(key) ? 'apenas letras, numeros, _ e -' : 'contem outros caracteres'
      }
    });
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
