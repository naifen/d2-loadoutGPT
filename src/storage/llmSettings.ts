// LLM endpoint settings (spec #1 "Storage"): persisted in extension local
// storage, sent nowhere but the configured endpoint. Read fresh on every
// chat turn; the Settings panel owns the editing UI.

import { browser } from 'wxt/browser';
import type { LlmEndpointSettings } from '../llm/openai';

const STORAGE_KEY = 'llmSettings';

export const DEFAULT_LLM_SETTINGS: LlmEndpointSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
};

export async function getLlmSettings(): Promise<LlmEndpointSettings> {
  const { [STORAGE_KEY]: stored } = await browser.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_LLM_SETTINGS, ...(stored as Partial<LlmEndpointSettings> | undefined) };
}

export async function saveLlmSettings(settings: LlmEndpointSettings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}

/** Enough settings to attempt a request — apiKey is optional (local servers). */
export function isLlmConfigured(settings: LlmEndpointSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.model.trim());
}
