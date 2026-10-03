// Wire history lives in session storage and is scoped to one Bungie login.

import { browser } from 'wxt/browser';
import type { ChatMessage } from '../agent/transport';
import { getTokens, withAuthSession } from '../bungie/auth';
import { isRecord } from '../type-guards';

const STORAGE_KEY = 'chatHistory';

export async function loadChatHistory(): Promise<ChatMessage[]> {
  const tokens = await getTokens();
  if (!tokens) return [];
  const stored = await withAuthSession(tokens.sessionId, () => browser.storage.session.get(STORAGE_KEY));
  const messages: unknown = stored[STORAGE_KEY];
  if (!Array.isArray(messages)) return [];
  if (!messages.every((message: unknown): message is ChatMessage =>
    isRecord(message) && typeof message.role === 'string' &&
    ['user', 'assistant', 'tool'].includes(message.role) &&
    (message.content === undefined || message.content === null || typeof message.content === 'string') &&
    (message.role !== 'tool' || typeof message.tool_call_id === 'string') &&
    (message.tool_calls === undefined || (Array.isArray(message.tool_calls) && message.tool_calls.every(
      (call: unknown) => isRecord(call) &&
        typeof call.id === 'string' && call.type === 'function' && isRecord(call.function) &&
        typeof call.function.name === 'string' && typeof call.function.arguments === 'string',
    ))),
  )) throw new Error('Stored conversation is invalid. Start a new conversation.');
  return messages;
}

export async function saveChatHistory(messages: ChatMessage[], sessionId: string, signal?: AbortSignal): Promise<void> {
  await withAuthSession(sessionId, async () => {
    signal?.throwIfAborted();
    await browser.storage.session.set({ [STORAGE_KEY]: messages });
  });
}

export async function clearChatHistory(): Promise<void> {
  await navigator.locks.request('bungie-session', () => browser.storage.session.remove(STORAGE_KEY));
}
