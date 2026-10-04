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
  /** One interactive public-client login. */
  sessionId: string;
  accessToken: string;
  /** ms since epoch */
  accessExpiresAt: number;
  /** Bungie.net membership id (not a Destiny membership id). */
  membershipId: string;
}

export async function getTokens(): Promise<BungieTokens | undefined> {
  const { [STORAGE_KEY]: tokens } = await browser.storage.session.get(STORAGE_KEY);
  if (!isRecord(tokens)) return undefined;
  const value = tokens;
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.accessToken !== 'string' ||
    typeof value.membershipId !== 'string' ||
    typeof value.accessExpiresAt !== 'number' || !Number.isFinite(value.accessExpiresAt)
  ) return undefined;
  return {
    sessionId: value.sessionId, accessToken: value.accessToken,
    membershipId: value.membershipId, accessExpiresAt: value.accessExpiresAt,
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
  const redirectUrl = browser.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: import.meta.env.WXT_BUNGIE_CLIENT_ID,
    response_type: 'code',
    state,
    // Must equal the Redirect URL registered on the Bungie app (see README). Bungie permits no scope param.
    redirect_uri: redirectUrl,
  });
  const redirect = await browser.identity.launchWebAuthFlow({ url: `${AUTHORIZE_URL}?${params}`, interactive: true });
  if (!redirect) throw new BungieError('unknown', 'Bungie login failed: the auth window closed without a redirect.');
  const callback = new URL(redirect);
  const expected = new URL(redirectUrl);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.username || callback.password || callback.hash) {
    throw new BungieError('unknown', 'Bungie login failed: unexpected OAuth redirect.');
  }
  const result = callback.searchParams;
  if (result.getAll('state').length !== 1 || result.get('state') !== state) {
    throw new BungieError('unknown', 'Bungie login failed: OAuth state mismatch.');
  }
  const code = result.get('code');
  if (!code || result.getAll('code').length !== 1 || result.has('error')) {
    throw new BungieError('unknown', 'Bungie login failed: no valid authorization code returned.');
  }
  const tokens = { ...await requestTokens(code, redirectUrl), sessionId: state };
  await navigator.locks.request('bungie-session', async () => {
    const revision = (await browser.storage.session.get(REVISION_KEY))[REVISION_KEY];
    if (revision !== state) throw new BungieError('login-required', 'This login attempt was cancelled by a newer login or logout.');
    await browser.storage.session.remove(['chatHistory', 'profileFetchedThisSession']);
    await browser.storage.local.remove('profileSnapshot');
    await browser.storage.session.set({ [STORAGE_KEY]: tokens });
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
      browser.storage.local.remove(['bungieTokens', 'profileSnapshot']),
      browser.storage.session.remove([STORAGE_KEY, 'chatHistory', 'profileFetchedThisSession']),
    ]);
  });
}

/**
 * Access token for Bungie Platform calls. Public clients receive no refresh
 * token: expiry clears account data and requires another interactive login.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (!tokens) throw new BungieError('login-required', 'Not logged in to Bungie.');
  if (Date.now() >= tokens.accessExpiresAt - EXPIRY_MARGIN_MS) {
    await logout(tokens.sessionId, tokens.accessToken);
    throw new BungieError('login-required', 'Your Bungie login has expired. Please log in again.');
  }
  return tokens.accessToken;
}

function checkCredentials(): void {
  if (!import.meta.env.WXT_BUNGIE_CLIENT_ID || !import.meta.env.WXT_BUNGIE_API_KEY) {
    throw new BungieError('config', 'Configure the Bungie public client id and API key in the browser env file, then rebuild.');
  }
}

async function requestTokens(code: string, redirectUrl: string): Promise<Omit<BungieTokens, 'sessionId'>> {
  checkCredentials();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: import.meta.env.WXT_BUNGIE_CLIENT_ID,
      redirect_uri: redirectUrl,
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
    // Invalid authorization codes require another interactive login.
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
    data.token_type !== 'Bearer' ||
    typeof data.membership_id !== 'string' || !data.membership_id ||
    typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
    !Number.isFinite(Date.now() + data.expires_in * 1000)
  ) throw new BungieError('unknown', 'Bungie returned an invalid token response.');
  const now = Date.now();
  return {
    accessToken: data.access_token,
    accessExpiresAt: now + data.expires_in * 1000,
    membershipId: data.membership_id,
  };
}
