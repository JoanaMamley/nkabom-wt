import type { Env } from './env';

// Only the app's own origins may call the API from a browser. Requests without an Origin, such as
// curl, get no CORS headers and are still checked for a sign-in like any other.
export function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((entry) => entry.trim());
  return origin && allowed.some((entry) => originMatches(origin, entry)) ? origin : null;
}

// An entry is an exact origin, or one with a single * for a run of lowercase letters, digits and
// hyphens, such as https://nkabom-staging--*.web.app for staging's Hosting preview channels
// (NKB-121), which are named nkabom-staging--{channel}-{random}.web.app.
function originMatches(origin: string, entry: string): boolean {
  if (!entry.includes('*')) {
    return origin === entry;
  }
  const [before, after] = entry
    .split('*', 2)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${before}[a-z0-9-]+${after}$`).test(origin);
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
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
