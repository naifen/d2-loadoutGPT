import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    async get(key: string) { return { [key]: structuredClone(data[key]) }; },
    async set(values: Record<string, unknown>) { Object.assign(data, structuredClone(values)); },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  });
  return {
    local, session,
    browser: {
      storage: { local: area(local), session: area(session) },
      identity: { getRedirectURL: () => 'https://fixture.chromiumapp.org/', launchWebAuthFlow: vi.fn() },
    },
  };
});
vi.mock('wxt/browser', () => ({ browser: storage.browser }));

import { getAccessToken, getTokens, login, logout } from '../src/bungie/auth';

const tokenResponse = { access_token: 'fixture-access', token_type: 'Bearer', expires_in: 3600, membership_id: '424242' };

beforeEach(() => {
  for (const data of [storage.local, storage.session]) {
    for (const key of Object.keys(data)) delete data[key];
  }
  vi.stubEnv('WXT_BUNGIE_CLIENT_ID', 'fixture-client');
  vi.stubEnv('WXT_BUNGIE_API_KEY', 'fixture-api');
  vi.stubGlobal('navigator', { locks: { request: (_name: string, action: () => Promise<unknown>) => action() } });
  storage.browser.identity.launchWebAuthFlow.mockReset();
  storage.browser.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
    const state = new URL(url).searchParams.get('state');
    return `https://fixture.chromiumapp.org/?code=fixture-code&state=${state}`;
  });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(tokenResponse)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('a public client can log in without a secret or refresh token and credentials stay in the browser session', async () => {
  const tokens = await login();
  expect(tokens.accessToken).toBe('fixture-access');
  expect(await getAccessToken()).toBe('fixture-access');
  expect(storage.local).not.toHaveProperty('bungieTokens');
  expect(storage.session.bungieTokens).toEqual(tokens);
  const [, request] = vi.mocked(fetch).mock.calls[0]!;
  expect((request!.body as URLSearchParams).has('client_secret')).toBe(false);
  delete storage.session.bungieTokens;
  expect(await getTokens()).toBeUndefined();
});

test.each([
  'https://attacker.example/?code=fixture-code',
  'https://fixture.chromiumapp.org/wrong-path?code=fixture-code',
  'https://fixture.chromiumapp.org/?code=fixture-code&state=wrong',
  'https://fixture.chromiumapp.org/?code=fixture-code&code=second',
])('a mismatched or ambiguous callback never exchanges a code: %s', async (redirect) => {
  storage.browser.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) =>
    `${redirect}&state=${new URL(url).searchParams.get('state')}`);
  await expect(login()).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await getTokens()).toBeUndefined();
});

test('expired public credentials clear private cached state and require another login', async () => {
  const tokens = await login();
  storage.session.bungieTokens = { ...tokens, accessExpiresAt: Date.now() + 59_000 };
  storage.session.chatHistory = [{ role: 'user', content: 'private history' }];
  storage.session.profileFetchedThisSession = tokens.sessionId;
  storage.local.profileSnapshot = { authSessionId: tokens.sessionId };
  await expect(getAccessToken()).rejects.toMatchObject({ kind: 'login-required' });
  expect(await getTokens()).toBeUndefined();
  expect(storage.session.chatHistory).toBeUndefined();
  expect(storage.local.profileSnapshot).toBeUndefined();
});

test('a token response arriving after logout cannot restore credentials or account data', async () => {
  let finish!: (response: Response) => void;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  vi.stubGlobal('fetch', vi.fn(() => {
    requested();
    return new Promise<Response>((resolve) => { finish = resolve; });
  }));
  const pending = login();
  await started;
  await logout();
  finish(Response.json(tokenResponse));
  await expect(pending).rejects.toMatchObject({ kind: 'login-required' });
  expect(await getTokens()).toBeUndefined();
  expect(storage.local.profileSnapshot).toBeUndefined();
});

test.each([
  { expires_in: 0 }, { expires_in: -1 }, { expires_in: 1e308 },
  { token_type: 'wrong' }, { access_token: '' }, { membership_id: '' },
])('invalid provider credentials are never stored: %j', async (invalid) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...tokenResponse, ...invalid })));
  await expect(login()).rejects.toMatchObject({ kind: 'unknown' });
  expect(await getTokens()).toBeUndefined();
});
