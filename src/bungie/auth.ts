import { browser } from 'wxt/browser';
import { clearChatHistory } from '../storage/chatHistory';
import { BungieError } from './errors';

const AUTHORIZE_URL = 'https://www.bungie.net/en/OAuth/Authorize';
const TOKEN_URL = 'https://www.bungie.net/platform/app/oauth/token/';
const STORAGE_KEY = 'bungieTokens';
// Treat tokens as expired a minute early so a request in flight never hits the wall.
const EXPIRY_MARGIN_MS = 60_000;

export interface BungieTokens {
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
  return tokens as BungieTokens | undefined;
}

/** Interactive Bungie OAuth via the browser identity API. Resolves with the stored tokens. */
export async function login(): Promise<BungieTokens> {
  const state = crypto.randomUUID();
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
  const tokens = await requestTokens({ grant_type: 'authorization_code', code });
  await browser.storage.local.set({ [STORAGE_KEY]: tokens });
  return tokens;
}

export async function logout(): Promise<void> {
  // Also drop the cached profile snapshot and the chat history — a different
  // account must not inherit this account's data.
  await browser.storage.local.remove([STORAGE_KEY, 'profileSnapshot']);
  await clearChatHistory();
}

let refreshing: Promise<BungieTokens> | undefined;

/**
 * Access token for Bungie Platform calls, silently refreshed when expired.
 * Throws BungieError('login-required') (and clears stored tokens) when the user must log in again.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (!tokens) throw new BungieError('login-required', 'Not logged in to Bungie.');
  const now = Date.now();
  if (now < tokens.accessExpiresAt - EXPIRY_MARGIN_MS) return tokens.accessToken;
  if (now >= tokens.refreshExpiresAt - EXPIRY_MARGIN_MS) {
    await logout();
    throw new BungieError('login-required', 'Your Bungie login has expired. Please log in again.');
  }
  // Share one in-flight refresh between concurrent callers; refresh tokens rotate.
  refreshing ??= refresh(tokens.refreshToken).finally(() => (refreshing = undefined));
  return (await refreshing).accessToken;
}

async function refresh(refreshToken: string): Promise<BungieTokens> {
  try {
    const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
    await browser.storage.local.set({ [STORAGE_KEY]: tokens });
    return tokens;
  } catch (e) {
    if (e instanceof BungieError && e.kind === 'login-required') await logout();
    throw e;
  }
}

async function requestTokens(grant: Record<string, string>): Promise<BungieTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...grant,
      client_id: import.meta.env.WXT_BUNGIE_CLIENT_ID,
      client_secret: import.meta.env.WXT_BUNGIE_CLIENT_SECRET,
    }),
  });
  // Token endpoint errors are OAuth-style {error, error_description}, not the Platform envelope.
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: string | undefined = body.error;
    const reason: string = body.error_description ?? err ?? `HTTP ${res.status}`;
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
  const now = Date.now();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessExpiresAt: now + body.expires_in * 1000,
    refreshExpiresAt: now + body.refresh_expires_in * 1000,
    membershipId: body.membership_id,
  };
}
