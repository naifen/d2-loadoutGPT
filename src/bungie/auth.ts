import { browser } from 'wxt/browser';
import { BungieError } from './errors';
import { isRecord } from '../type-guards';

const AUTHORIZE_URL = 'https://www.bungie.net/en/OAuth/Authorize';
const TOKEN_URL = 'https://www.bungie.net/platform/app/oauth/token/';
const STORAGE_KEY = 'bungieTokens';
const REVISION_KEY = 'bungieAuthRevision';
// Treat tokens as expired a minute early so a request in flight never hits the wall.
const EXPIRY_MARGIN_MS = 60_000;

export interface BungieTokens {
  /** One interactive login; token refresh preserves it. */
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  accessExpiresAt: number;
  /** ms since epoch */
  refreshExpiresAt: number;
  /** Bungie.net membership id (not a Destiny membership id). */
  membershipId: string;
}

export async function getTokens(): Promise<BungieTokens | undefined> {
  const { [STORAGE_KEY]: tokens } = await browser.storage.local.get(STORAGE_KEY);
  if (!isRecord(tokens)) return undefined;
  const value = tokens;
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.accessToken !== 'string' ||
    typeof value.refreshToken !== 'string' ||
    typeof value.membershipId !== 'string' ||
    typeof value.accessExpiresAt !== 'number' || !Number.isFinite(value.accessExpiresAt) ||
    typeof value.refreshExpiresAt !== 'number' || !Number.isFinite(value.refreshExpiresAt)
  ) return undefined;
  return {
    sessionId: value.sessionId, accessToken: value.accessToken, refreshToken: value.refreshToken,
    membershipId: value.membershipId, accessExpiresAt: value.accessExpiresAt, refreshExpiresAt: value.refreshExpiresAt,
  };
}

/** Serialize account-owned writes with logout, across all open panels. */
export async function withAuthSession<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
  return navigator.locks.request('bungie-session', async () => {
    if ((await getTokens())?.sessionId !== sessionId) {
      throw new BungieError('login-required', 'The Bungie account changed. Please try again.');
    }
    return action();
  });
}

/** Interactive Bungie OAuth via the browser identity API. Resolves with the stored tokens. */
export async function login(): Promise<BungieTokens> {
  checkCredentials();
  const state = crypto.randomUUID();
  await navigator.locks.request('bungie-session', () => browser.storage.session.set({ [REVISION_KEY]: state }));
  const params = new URLSearchParams({
    client_id: import.meta.env.WXT_BUNGIE_CLIENT_ID,
    response_type: 'code',
    state,
    // Must equal the Redirect URL registered on the Bungie app (see README). Bungie permits no scope param.
    redirect_uri: browser.identity.getRedirectURL(),
  });
  const redirect = await browser.identity.launchWebAuthFlow({ url: `${AUTHORIZE_URL}?${params}`, interactive: true });
  if (!redirect) throw new BungieError('unknown', 'Bungie login failed: the auth window closed without a redirect.');
  const result = new URL(redirect).searchParams;
  if (result.get('state') !== state) throw new BungieError('unknown', 'Bungie login failed: OAuth state mismatch.');
  const code = result.get('code');
  if (!code) throw new BungieError('unknown', 'Bungie login failed: no authorization code returned.');
  const tokens = { ...await requestTokens({ grant_type: 'authorization_code', code }), sessionId: state };
  await navigator.locks.request('bungie-session', async () => {
    const revision = (await browser.storage.session.get(REVISION_KEY))[REVISION_KEY];
    if (revision !== state) throw new BungieError('login-required', 'This login attempt was cancelled by a newer login or logout.');
    await browser.storage.session.remove(['chatHistory', 'profileFetchedThisSession']);
    await browser.storage.local.remove('profileSnapshot');
    await browser.storage.local.set({ [STORAGE_KEY]: tokens });
  });
  return tokens;
}

export async function logout(expectedSessionId?: string, expectedAccessToken?: string): Promise<void> {
  await navigator.locks.request('bungie-session', async () => {
    const current = await getTokens();
    if (expectedSessionId && current?.sessionId !== expectedSessionId) return;
    if (expectedAccessToken && current?.accessToken !== expectedAccessToken) return;
    await browser.storage.session.set({ [REVISION_KEY]: crypto.randomUUID() });
    await Promise.all([
      browser.storage.local.remove([STORAGE_KEY, 'profileSnapshot']),
      browser.storage.session.remove(['chatHistory', 'profileFetchedThisSession']),
    ]);
  });
}

/**
 * Access token for Bungie Platform calls, silently refreshed when expired.
 * Throws BungieError('login-required') (and clears stored tokens) when the user must log in again.
 */
export async function getAccessToken(): Promise<string> {
  // A browser-wide lock protects rotating refresh tokens, even across panels.
  return navigator.locks.request('bungie-refresh', async () => {
    const tokens = await getTokens();
    if (!tokens) throw new BungieError('login-required', 'Not logged in to Bungie.');
    const now = Date.now();
    if (now < tokens.accessExpiresAt - EXPIRY_MARGIN_MS) return tokens.accessToken;
    if (now >= tokens.refreshExpiresAt - EXPIRY_MARGIN_MS) {
      await logout(tokens.sessionId);
      throw new BungieError('login-required', 'Your Bungie login has expired. Please log in again.');
    }
    try {
      const updated = {
        ...await requestTokens({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
        sessionId: tokens.sessionId,
      };
      await withAuthSession(tokens.sessionId, () => browser.storage.local.set({ [STORAGE_KEY]: updated }));
      return updated.accessToken;
    } catch (e) {
      if (e instanceof BungieError && e.kind === 'login-required') await logout(tokens.sessionId);
      throw e;
    }
  });
}

function checkCredentials(): void {
  if (!import.meta.env.WXT_BUNGIE_CLIENT_ID || !import.meta.env.WXT_BUNGIE_CLIENT_SECRET) {
    throw new BungieError('config', 'Configure the Bungie client id and client secret in the browser env file, then rebuild.');
  }
}

async function requestTokens(grant: Record<string, string>): Promise<Omit<BungieTokens, 'sessionId'>> {
  checkCredentials();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...grant,
      client_id: import.meta.env.WXT_BUNGIE_CLIENT_ID,
      client_secret: import.meta.env.WXT_BUNGIE_CLIENT_SECRET,
    }),
  });
  // Token endpoint errors are OAuth-style {error, error_description}, not the Platform envelope.
  const body: unknown = await res.json().catch(() => undefined);
  if (!isRecord(body)) throw new BungieError('unknown', 'Bungie returned an invalid token response.');
  const data = body;
  if (!res.ok) {
    const err = typeof data.error === 'string' ? data.error : undefined;
    const reason = typeof data.error_description === 'string' ? data.error_description : err ?? `HTTP ${res.status}`;
    if (err === 'invalid_client') throw new BungieError('config', 'Bungie rejected the app credentials. Check the browser env file and rebuild.');
    if (reason === 'SystemDisabled') {
      throw new BungieError('maintenance', 'Bungie.net is down for maintenance. Try again later.');
    }
    // Fatal = the refresh token is dead and only a fresh login recovers. Anything else
    // (server_error, 5xx, ...) keeps the stored tokens and is retried on the next call.
    const fatal =
      res.status === 401 ||
      res.status === 403 ||
      err === 'invalid_grant' ||
      /^(Authorization|RefreshToken|AccessToken)/.test(reason);
    throw new BungieError(
      fatal ? 'login-required' : 'unknown',
      `Bungie rejected the login (${reason}).${fatal ? ' Please log in again.' : ''}`,
    );
  }
  if (
    typeof data.access_token !== 'string' || !data.access_token ||
    typeof data.refresh_token !== 'string' || !data.refresh_token ||
    typeof data.membership_id !== 'string' || !data.membership_id ||
    typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
    typeof data.refresh_expires_in !== 'number' || !Number.isFinite(data.refresh_expires_in) || data.refresh_expires_in <= 0
  ) throw new BungieError('unknown', 'Bungie returned an invalid token response.');
  const now = Date.now();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: now + data.expires_in * 1000,
    refreshExpiresAt: now + data.refresh_expires_in * 1000,
    membershipId: data.membership_id,
  };
}
