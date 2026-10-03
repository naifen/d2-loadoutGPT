// LLM endpoint settings (spec #1 "Storage"): persisted in extension local
// storage, sent nowhere but the configured endpoint. Read fresh on every
// chat turn; the Settings panel owns the editing UI.

import { browser } from 'wxt/browser';
import type { LlmEndpointSettings } from '../llm/openai';
import { isRecord } from '../type-guards';
import { completionUrl } from '../llm/openai';

const STORAGE_KEY = 'llmSettings';

export const DEFAULT_LLM_SETTINGS: LlmEndpointSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
};

export async function getLlmSettings(): Promise<LlmEndpointSettings> {
  const { [STORAGE_KEY]: stored } = await browser.storage.local.get(STORAGE_KEY);
  if (stored === undefined) return DEFAULT_LLM_SETTINGS;
  if (!isRecord(stored) || typeof stored.baseUrl !== 'string' || typeof stored.apiKey !== 'string' || typeof stored.model !== 'string') {
    throw new Error('Stored LLM settings are invalid. Save the endpoint settings again.');
  }
  return { baseUrl: stored.baseUrl, apiKey: stored.apiKey, model: stored.model };
}

export async function saveLlmSettings(settings: LlmEndpointSettings): Promise<void> {
  completionUrl(settings.baseUrl);
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}

/** Enough settings to attempt a request — apiKey is optional (local servers). */
export function isLlmConfigured(settings: LlmEndpointSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.model.trim());
}
