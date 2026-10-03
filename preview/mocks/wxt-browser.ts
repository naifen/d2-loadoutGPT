// In-memory stand-in for `wxt/browser` — lets the real panel components mount
// outside an extension context. Only the members the UI touches are stubbed.

const noop = () => {};

const storageArea = () => ({
  get: async (_keys?: unknown): Promise<Record<string, unknown>> => ({}),
  set: async (_items: Record<string, unknown>) => {},
  remove: async (_keys: unknown) => {},
  clear: async () => {},
});

export const browser = {
  storage: {
    local: storageArea(),
    session: storageArea(),
    sync: storageArea(),
    onChanged: {
      addListener: noop,
      removeListener: noop,
      hasListener: () => false,
    },
  },
  tabs: {
    create: async (_props: { url?: string }) => ({ id: 1 }),
  },
  windows: {
    create: async () => ({ id: 1 }),
  },
  runtime: {
    id: 'd2-loadoutgpt-preview',
    lastError: undefined,
  },
  identity: {},
};

export type Browser = typeof browser;
export default browser;
