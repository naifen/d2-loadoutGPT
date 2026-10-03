import { useEffect, useState } from 'preact/hooks';
import { getTokens, login, logout, type BungieTokens } from '../bungie/auth';
import { bungieFetch } from '../bungie/http';

interface Memberships {
  bungieNetUser: { uniqueName: string };
}

export function Settings() {
  const [tokens, setTokens] = useState<BungieTokens | undefined>();
  const [name, setName] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Also exercises bungieFetch (API key, Origin, silent refresh) on every panel open.
  async function sync() {
    const t = await getTokens();
    setTokens(t);
    if (!t) return setName(undefined);
    try {
      setName((await bungieFetch<Memberships>('/User/GetMembershipsForCurrentUser/')).bungieNetUser.uniqueName);
    } catch (e) {
      setError((e as Error).message);
      setTokens(await getTokens()); // bungieFetch clears tokens on auth failures
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    await sync();
    setBusy(false);
  }

  useEffect(() => {
    sync();
  }, []);

  return (
    <section>
      <h2>Bungie account</h2>
      {tokens ? (
        <p>
          Signed in as {name ?? `membership ${tokens.membershipId}`}{' '}
          <button disabled={busy} onClick={() => run(logout)}>
            Log out
          </button>
        </p>
      ) : (
        <button disabled={busy} onClick={() => run(login)}>
          Log in with Bungie
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
