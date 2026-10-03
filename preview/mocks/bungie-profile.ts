// Three characters on a plausible snapshot so the Characters section renders
// its populated state.

import type { CharacterRow, ProfileSnapshot } from '../../src/bungie/profile';

const ROWS: CharacterRow[] = [
  { id: '2305843009299010001', className: 'Hunter', classType: 1, light: 2010, emblemPath: '' },
  { id: '2305843009299010002', className: 'Titan', classType: 0, light: 2008, emblemPath: '' },
  { id: '2305843009299010003', className: 'Warlock', classType: 2, light: 2005, emblemPath: '' },
];

const SNAPSHOT = {
  fetchedAt: Date.now() - 8 * 60_000,
  membership: { type: 3, id: '4611686018400000000' },
} as unknown as ProfileSnapshot;

export async function getSnapshot(_forceRefresh = false): Promise<ProfileSnapshot> {
  return SNAPSHOT;
}

export function charactersFromSnapshot(_snapshot: ProfileSnapshot): CharacterRow[] {
  return ROWS;
}
