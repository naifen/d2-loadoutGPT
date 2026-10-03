// The preview opens "mid-session": the canned wire history rebuilds into a
// populated conversation (tool rows checked off, one build card).

import type { ChatMessage } from '../../src/agent/transport';
import { PREVIEW_HISTORY } from './fixtures';

export async function loadChatHistory(): Promise<ChatMessage[]> {
  return PREVIEW_HISTORY;
}

export async function saveChatHistory(
  _messages: ChatMessage[],
  _sessionId: string,
  _signal?: AbortSignal,
): Promise<void> {}

export async function clearChatHistory(): Promise<void> {}
