// A configured LLM endpoint so Settings renders the populated form and the
// chat treats the assistant as ready.

import type { LlmSettings } from '../../src/storage/llmSettings';
import type { LlmEndpointSettings } from '../../src/llm/openai';

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  rememberKey: false,
};

const saved: LlmSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-5-mini',
  rememberKey: false,
};

export async function getLlmSettings(): Promise<LlmSettings> {
  return { ...saved };
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  Object.assign(saved, settings);
}

export function isLlmConfigured(settings: LlmEndpointSettings): boolean {
  return Boolean(settings.baseUrl && settings.model);
}
