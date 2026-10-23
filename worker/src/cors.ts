import type { Env } from './env';

// Only the app's own origins may call the API from a browser. Requests without an Origin, such as
// curl, get no CORS headers and are still checked for a sign-in like any other.
export function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((entry) => entry.trim());
  return origin && allowed.includes(origin) ? origin : null;
}

export function preflight(request: Request, env: Env): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const result = new Response(response.body, response);
  result.headers.append('Vary', 'Origin');
  const origin = allowedOrigin(request, env);
  if (origin) {
    result.headers.set('Access-Control-Allow-Origin', origin);
  }
  return result;
}
