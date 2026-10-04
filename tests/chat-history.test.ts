import { afterEach, expect, test, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    async get(key: string) { return { [key]: data[key] }; },
    async set(values: Record<string, unknown>) { Object.assign(data, values); },
    async remove(keys: string | string[]) { for (const key of [keys].flat()) delete data[key]; },
  });
  return { local, session, browser: { storage: { local: area(local), session: area(session) } } };
});
vi.mock('wxt/browser', () => ({ browser: storage.browser }));

import { logout } from '../src/bungie/auth';
import { loadChatHistory, saveChatHistory } from '../src/storage/chatHistory';

afterEach(() => vi.unstubAllGlobals());

test('private history requires an owned login and cannot be restored by a late write after logout', async () => {
  vi.stubGlobal('navigator', { locks: { request: (_name: string, action: () => Promise<unknown>) => action() } });
  const privateMessages = [{ role: 'user', content: 'private fixture history' }];
  storage.session.chatHistory = privateMessages;
  expect(await loadChatHistory()).toEqual([]);

  const tokens = {
    accessToken: 'fixture', membershipId: 'fixture-account',
    accessExpiresAt: Date.now() + 3_600_000,
  };
  storage.session.bungieTokens = tokens; // Unowned tokens cannot restore private history.
  expect(await loadChatHistory()).toEqual([]);
  storage.session.bungieTokens = { ...tokens, sessionId: 'owned-session' };
  expect(await loadChatHistory()).toEqual(privateMessages);

  await logout();
  await expect(saveChatHistory([{ role: 'user', content: 'late private result' }], 'owned-session'))
    .rejects.toThrow(/account changed/);
  expect(await loadChatHistory()).toEqual([]);
  expect(storage.session.chatHistory).toBeUndefined();
});
