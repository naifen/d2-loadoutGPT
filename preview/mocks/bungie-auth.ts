// Signed-in Bungie session for the preview: Settings shows "Signed in as …"
// and the chat treats the account as connected.

import type { BungieTokens } from '../../src/bungie/auth';

const TOKENS: BungieTokens = {
  sessionId: 'preview-session',
  accessToken: 'preview-access',
  accessExpiresAt: Date.now() + 3_600_000,
  membershipId: '424242',
};

export type { BungieTokens };

export async function getTokens(): Promise<BungieTokens | undefined> {
  return TOKENS;
}

export async function login(): Promise<BungieTokens> {
  return TOKENS;
}

export async function logout(): Promise<void> {}

export async function getAccessToken(): Promise<string> {
  return TOKENS.accessToken;
}

export async function withAuthSession<T>(_sessionId: string, action: () => Promise<T>): Promise<T> {
  return action();
}
