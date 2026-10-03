// Shared JSON-object boundary; callers still validate the fields they consume.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
