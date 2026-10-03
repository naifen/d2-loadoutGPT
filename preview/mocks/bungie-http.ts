// Canned Bungie API responses for the preview.

export async function bungieFetch<T>(path: string): Promise<T> {
  if (path === '/User/GetMembershipsForCurrentUser/') {
    return { bungieNetUser: { uniqueName: 'Guardian#4242' } } as T;
  }
  throw new Error(`preview mock: unhandled bungieFetch(${path})`);
}
