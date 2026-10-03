export type BungieErrorKind = 'maintenance' | 'throttled' | 'login-required' | 'config' | 'unknown';

/** Any failure talking to Bungie, with a message fit for the panel's error line. */
export class BungieError extends Error {
  constructor(
    readonly kind: BungieErrorKind,
    message: string,
    readonly errorCode?: number,
    readonly throttleSeconds?: number,
  ) {
    super(message);
    this.name = 'BungieError';
  }
}
