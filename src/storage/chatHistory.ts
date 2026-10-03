// Chat history (spec #1 "Storage"): the agent runner's OpenAI wire history
// (user/assistant/tool messages, no system prompt) kept in session storage —
// gone when the browser closes. Writes are best-effort: tool results can be
// large, and if the quota is exceeded the in-memory conversation still works.

import { browser } from 'wxt/browser';
import type { ChatMessage } from '../agent/transport';

const STORAGE_KEY = 'chatHistory';

export async function loadChatHistory(): Promise<ChatMessage[]> {
  const stored = await browser.storage.session?.get(STORAGE_KEY).catch(() => undefined);
  return (stored?.[STORAGE_KEY] as ChatMessage[] | undefined) ?? [];
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  await browser.storage.session?.set({ [STORAGE_KEY]: messages }).catch(() => {});
}

export async function clearChatHistory(): Promise<void> {
  await browser.storage.session?.remove(STORAGE_KEY).catch(() => {});
}
