import { expect, test } from 'vitest';
import {
  charactersFromSnapshot,
  pickLinkedProfile,
  pickMembership,
  type DestinyCharacter,
  type ProfileSnapshot,
  type UserMembershipCard,
} from '../src/bungie/profile';

const m = (membershipType: number, membershipId: string, crossSaveOverride = 0): UserMembershipCard => ({
  membershipType,
  membershipId,
  crossSaveOverride,
});

test('primaryMembershipId wins when cross-save is active', () => {
  const memberships = [m(1, 'xbox'), m(3, 'steam')];
  expect(pickMembership(memberships, 'steam')).toEqual([memberships[1]]);
});

test('memberships overridden by cross-save are dropped', () => {
  const xbox = m(1, 'xbox', 3); // overridden by the Steam account
  const steam = m(3, 'steam');
  expect(pickMembership([xbox, steam])).toEqual([steam]);
});

test('crossSaveOverride equal to own type still counts as active', () => {
  expect(pickMembership([m(3, 'steam', 3)])).toEqual([m(3, 'steam', 3)]);
});

test('several active memberships stay ambiguous; none yields empty', () => {
  expect(pickMembership([m(1, 'xbox'), m(2, 'psn')])).toHaveLength(2);
  expect(pickMembership([])).toHaveLength(0);
});

test('most recently played non-overridden linked profile wins', () => {
  const profiles = [
    { membershipId: 'a', membershipType: 1, dateLastPlayed: '2025-01-01T00:00:00Z' },
    { membershipId: 'b', membershipType: 2, dateLastPlayed: '2025-02-01T00:00:00Z' },
    { membershipId: 'c', membershipType: 3, dateLastPlayed: '2025-03-01T00:00:00Z', isOverridden: true },
  ];
  expect(pickLinkedProfile(profiles)?.membershipId).toBe('b');
  expect(
    pickLinkedProfile([{ membershipId: 'a', membershipType: 1, dateLastPlayed: '2025-01-01T00:00:00Z', isOverridden: true }]),
  ).toBeUndefined();
});

const char = (classType: number, light: number): DestinyCharacter => ({
  membershipId: 'dmid',
  membershipType: 3,
  characterId: `char-${classType}`,
  classType,
  light,
  emblemPath: `/emblem/${classType}`,
  emblemBackgroundPath: '',
  emblemHash: 1,
  dateLastPlayed: '2025-01-01T00:00:00Z',
  minutesPlayedTotal: '100',
  raceType: 0,
  genderType: 0,
});

test('charactersFromSnapshot maps class names and light', () => {
  const snapshot: ProfileSnapshot = {
    fetchedAt: 0,
    membership: { type: 3, id: 'dmid' },
    characters: { data: { a: char(0, 2010), b: char(2, 1990) }, privacy: 1 },
  };
  expect(charactersFromSnapshot(snapshot)).toEqual([
    { id: 'char-0', className: 'Titan', classType: 0, light: 2010, emblemPath: '/emblem/0' },
    { id: 'char-2', className: 'Warlock', classType: 2, light: 1990, emblemPath: '/emblem/2' },
  ]);
  expect(charactersFromSnapshot({ fetchedAt: 0, membership: { type: 3, id: 'x' } })).toEqual([]);
});
