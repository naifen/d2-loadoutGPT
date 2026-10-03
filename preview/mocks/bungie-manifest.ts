// Manifest reads resolve instantly in the preview: status line shows the
// ready state and the chat gets a (never actually queried) handle.

import type { ManifestHandle, ManifestVersion } from '../../src/bungie/manifest';

interface ManifestProgress {
  table: string;
  done: number;
  total: number;
}

export async function ensureManifest(
  _onProgress?: (p: ManifestProgress) => void,
): Promise<ManifestVersion> {
  return 'v9.26.1.4' as ManifestVersion;
}

export async function openManifest(): Promise<ManifestHandle> {
  return { close() {} } as unknown as ManifestHandle;
}
