import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    async get(key: string) { return { [key]: structuredClone(data[key]) }; },
    async set(values: Record<string, unknown>) { Object.assign(data, structuredClone(values)); },
  });
  return { local, session, browser: { storage: { local: area(local), session: area(session) } } };
});
vi.mock('wxt/browser', () => ({ browser: storage.browser }));

import { getLlmSettings, saveLlmSettings } from '../src/storage/llmSettings';

const settings = {
  baseUrl: 'https://models.example/v1', apiKey: 'fixture-secret', model: 'fixture', rememberKey: false,
};

beforeEach(() => {
  for (const data of [storage.local, storage.session]) {
    for (const key of Object.keys(data)) delete data[key];
  }
  vi.stubGlobal('navigator', { locks: { request: (_name: string, action: () => Promise<unknown>) => action() } });
});
afterEach(() => vi.unstubAllGlobals());

test('a session-only key is available on panel reopen but absent after a browser session reset', async () => {
  await saveLlmSettings(settings);
  expect(storage.local.llmSettings).not.toHaveProperty('apiKey');
  expect((await getLlmSettings()).apiKey).toBe(settings.apiKey);
  delete storage.session.llmApiKey;
  const reopened = await getLlmSettings();
  expect(reopened.apiKey).toBe('');
  expect(reopened.model).toBe(settings.model);
  expect(reopened.rememberKey).toBe(false);
});

test('remembering is opt-in and disabling it removes the persistent key', async () => {
  await saveLlmSettings({ ...settings, rememberKey: true });
  delete storage.session.llmApiKey;
  const remembered = await getLlmSettings();
  expect(remembered.apiKey).toBe(settings.apiKey);
  expect(remembered.rememberKey).toBe(true);
  await saveLlmSettings({ ...remembered, rememberKey: false });
  expect(storage.local.llmSettings).not.toHaveProperty('apiKey');
  expect((await getLlmSettings()).apiKey).toBe(settings.apiKey);
  delete storage.session.llmApiKey;
  expect((await getLlmSettings()).apiKey).toBe('');
});

test('legacy persisted keys move to the session without silently granting remember consent', async () => {
  const { rememberKey: _rememberKey, ...legacy } = settings;
  storage.local.llmSettings = legacy;
  const migrated = await getLlmSettings();
  expect(migrated.apiKey).toBe(settings.apiKey);
  expect(migrated.rememberKey).toBe(false);
  expect(storage.local.llmSettings).not.toHaveProperty('apiKey');
  delete storage.session.llmApiKey;
  expect((await getLlmSettings()).apiKey).toBe('');
});

test('a session key cannot be restored for a different endpoint origin', async () => {
  await saveLlmSettings(settings);
  storage.local.llmSettings = { ...settings, baseUrl: 'https://other.example/v1', apiKey: undefined };
  expect((await getLlmSettings()).apiKey).toBe('');
});

test('an invalid endpoint cannot replace the saved credential or endpoint', async () => {
  await saveLlmSettings(settings);
  await expect(saveLlmSettings({ ...settings, baseUrl: 'http://remote.example/v1', apiKey: 'wrong-secret' }))
    .rejects.toThrow(/HTTPS/);
  const retained = await getLlmSettings();
  expect(retained.baseUrl).toBe(settings.baseUrl);
  expect(retained.apiKey).toBe(settings.apiKey);
});
