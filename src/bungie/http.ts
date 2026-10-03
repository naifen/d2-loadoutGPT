import { getAccessToken, getTokens, logout, withAuthSession } from './auth';
import { BungieError } from './errors';

export { BungieError } from './errors';

const PLATFORM_URL = 'https://www.bungie.net/Platform';

// PlatformErrorCodes (https://bungie-net.github.io/multi/schema_Exceptions-PlatformErrorCodes.html)
const SYSTEM_DISABLED = 5;
const THROTTLED = new Set([31, 35, 36, 37, 51, 54, 55, 56, 57]);
const LOGIN_REQUIRED = new Set([22, 99, 2106, 2110, 2111, 2122, 2123, 2124]);
const APP_CONFIG = new Set([2101, 2102, 2103, 2107, 2108]);

interface Envelope<T> {
  Response: T;
  ErrorCode: number;
  ErrorStatus: string;
  Message: string;
  ThrottleSeconds: number;
}

/**
 * Authenticated GET/POST against the Bungie Platform API. `path` is relative to
 * `https://www.bungie.net/Platform`, e.g. `/User/GetMembershipsForCurrentUser/`.
 * Resolves with the envelope's `Response`; throws BungieError otherwise.
 */
export async function bungieFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const tokens = await getTokens();
  if (!tokens) throw new BungieError('login-required', 'Not logged in to Bungie.');
  const sessionId = tokens.sessionId;
  const token = await getAccessToken();
  if ((await getTokens())?.sessionId !== sessionId) {
    throw new BungieError('login-required', 'The Bungie account changed. Please try again.');
  }
  const headers = new Headers(init?.headers);
  headers.set('X-API-Key', import.meta.env.WXT_BUNGIE_API_KEY);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(PLATFORM_URL + path, { ...init, headers, redirect: 'error' });

  // Maintenance responses can be HTML or OAuth-style {error, error_description}.
  const body: Partial<Envelope<T>> & { error_description?: string } = await res.json().catch(() => ({}));
  const code = body.ErrorCode;

  if (res.status === 401 || (code !== undefined && LOGIN_REQUIRED.has(code))) {
    await logout(sessionId, token);
    throw new BungieError('login-required', 'Your Bungie session has expired. Please log in again.', code);
  }
  if (code === 1) return withAuthSession(sessionId, async () => body.Response as T);
  if (code === SYSTEM_DISABLED || body.error_description === 'SystemDisabled') {
    throw new BungieError('maintenance', `Bungie.net is down for maintenance. ${body.Message ?? ''}`.trim(), code);
  }
  if (code !== undefined && THROTTLED.has(code)) {
    const wait = body.ThrottleSeconds || 0;
    throw new BungieError('throttled', `Bungie is throttling requests; try again in ${wait || 'a few'} seconds.`, code, wait);
  }
  if (code !== undefined && APP_CONFIG.has(code)) {
    throw new BungieError(
      'config',
      `Bungie app configuration problem (${body.ErrorStatus}): check the API key, Origin Header (*) and scopes.`,
      code,
    );
  }
  const detail = body.Message ?? body.error_description ?? `HTTP ${res.status}`;
  throw new BungieError('unknown', `Bungie error${body.ErrorStatus ? ` ${body.ErrorStatus}` : ''}: ${detail}`, code);
}
