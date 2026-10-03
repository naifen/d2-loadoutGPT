// Endpoint/model settings persist locally; API keys stay in memory unless the
// user explicitly chooses to remember them on this device. Read fresh on every
// chat turn; the Settings panel owns the editing UI.

import { browser } from 'wxt/browser';
import type { LlmEndpointSettings } from '../llm/openai';
import { isRecord } from '../type-guards';
import { completionUrl } from '../llm/openai';

const STORAGE_KEY = 'llmSettings';
const API_KEY_STORAGE_KEY = 'llmApiKey';

export interface LlmSettings extends LlmEndpointSettings {
  rememberKey: boolean;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  rememberKey: false,
};

export async function getLlmSettings(): Promise<LlmSettings> {
  return navigator.locks.request('llm-settings', async () => {
    const { [STORAGE_KEY]: stored } = await browser.storage.local.get(STORAGE_KEY);
    if (stored === undefined) return DEFAULT_LLM_SETTINGS;
    if (!isRecord(stored) || typeof stored.baseUrl !== 'string' || typeof stored.model !== 'string'
      || (stored.apiKey !== undefined && typeof stored.apiKey !== 'string')
      || (stored.rememberKey !== undefined && typeof stored.rememberKey !== 'boolean')) {
      throw new Error('Stored LLM settings are invalid. Save the endpoint settings again.');
    }
    const origin = new URL(completionUrl(stored.baseUrl)).origin;
    const settings = { baseUrl: stored.baseUrl, model: stored.model, rememberKey: stored.rememberKey === true };
    let { [API_KEY_STORAGE_KEY]: session } = await browser.storage.session.get(API_KEY_STORAGE_KEY);
    // Earlier builds persisted every key without consent. Keep it for this
    // session, but remove the disk copy unless remembering was explicitly chosen.
    if (!settings.rememberKey && typeof stored.apiKey === 'string') {
      session = { origin, apiKey: stored.apiKey };
      await browser.storage.session.set({ [API_KEY_STORAGE_KEY]: session });
      await browser.storage.local.set({ [STORAGE_KEY]: settings });
    }
    const apiKey = settings.rememberKey ? stored.apiKey ?? ''
      : isRecord(session) && session.origin === origin && typeof session.apiKey === 'string' ? session.apiKey : '';
    return { ...settings, apiKey };
  });
}

export async function saveLlmSettings({ baseUrl, apiKey, model, rememberKey }: LlmSettings): Promise<void> {
  const origin = new URL(completionUrl(baseUrl)).origin;
  await navigator.locks.request('llm-settings', async () => {
    await browser.storage.session.set({ [API_KEY_STORAGE_KEY]: { origin, apiKey } });
    await browser.storage.local.set({
      [STORAGE_KEY]: { baseUrl, model, rememberKey, ...(rememberKey ? { apiKey } : {}) },
    });
  });
}

/** Enough settings to attempt a request — apiKey is optional (local servers). */
export function isLlmConfigured(settings: LlmEndpointSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.model.trim());
}
