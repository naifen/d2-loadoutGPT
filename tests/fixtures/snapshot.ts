// Synthetic ProfileSnapshot for agent-runner tests: a vault + two characters
// holding the items defined in tests/fixtures/manifest.ts.
//
// Layout:
//   vault:            w1 Sunpiercer (solar HC), a1 Aion Renewal Casque (masterworked)
//   titan-1 equipped: a2 Aion Renewal Grips, w2 Nightmare String (exotic), s1 Sunbreaker
//   titan-1 backpack: w3 Linecutter (strand LFR)
//   hunter-1 equip.:  a3 Wildwood Vest
// Artifact: Tablet of Ruin, 10 points acquired, 3 spent on titan-1.

import type { DestinyProgression, ProfileSnapshot } from '../../src/bungie/profile';
import { BUCKET_HASHES, STAT_HASHES } from '../../src/bungie/constants';
import { DT, HASH } from './manifest';

export const TITAN_ID = '2305843000000000001';
export const HUNTER_ID = '2305843000000000002';

const prog = (): DestinyProgression => ({
  progressionHash: 0,
  dailyProgress: 0,
  dailyLimit: 0,
  weeklyProgress: 0,
  weeklyLimit: 0,
  currentProgress: 0,
  level: 0,
  levelCap: 0,
  stepIndex: 0,
  progressToNextLevel: 0,
  nextLevelAt: 0,
});

const plug = (plugItemHash: number, unlocked = true) => ({
  plugItemHash,
  canInsert: unlocked,
  enabled: unlocked,
  insertFailIndexes: [],
  enableFailIndexes: [],
});

const socket = (plugHash: number) => ({ plugHash, isEnabled: true, isVisible: true });

export function createFixtureSnapshot(): ProfileSnapshot {
  return {
    fetchedAt: 1759900000000,
    membership: { type: 3, id: '4611686018000000000' },
    profile: {
      data: {
        userInfo: { membershipType: 3, membershipId: '4611686018000000000', displayName: 'Guardian' },
        characterIds: [TITAN_ID, HUNTER_ID],
        dateLastPlayed: '2025-09-01T00:00:00Z',
      },
      privacy: 1,
    },
    characters: {
      data: {
        [TITAN_ID]: {
          membershipId: '4611686018000000000',
          membershipType: 3,
          characterId: TITAN_ID,
          classType: 0,
          light: 2010,
          emblemPath: '/emblem/titan',
          emblemBackgroundPath: '/emblem/titan-bg',
          emblemHash: 777,
          dateLastPlayed: '2025-09-01T00:00:00Z',
          minutesPlayedTotal: '5000',
          raceType: 0,
          genderType: 0,
        },
        [HUNTER_ID]: {
          membershipId: '4611686018000000000',
          membershipType: 3,
          characterId: HUNTER_ID,
          classType: 1,
          light: 1998,
          emblemPath: '/emblem/hunter',
          emblemBackgroundPath: '/emblem/hunter-bg',
          emblemHash: 778,
          dateLastPlayed: '2025-08-01T00:00:00Z',
          minutesPlayedTotal: '2500',
          raceType: 1,
          genderType: 1,
        },
      },
      privacy: 1,
    },
    profileInventory: {
      data: {
        items: [
          { itemHash: HASH.sunpiercer, itemInstanceId: 'w1', quantity: 1, bucketHash: BUCKET_HASHES.kinetic, location: 2, transferStatus: 0, state: 0 },
          { itemHash: HASH.aionHelmet, itemInstanceId: 'a1', quantity: 1, bucketHash: BUCKET_HASHES.helmet, location: 2, transferStatus: 0, state: 4 },
        ],
      },
    },
    characterEquipment: {
      data: {
        [TITAN_ID]: {
          items: [
            { itemHash: HASH.aionGauntlets, itemInstanceId: 'a2', quantity: 1, bucketHash: BUCKET_HASHES.arms, location: 1, transferStatus: 1, state: 0 },
            { itemHash: HASH.nightmareString, itemInstanceId: 'w2', quantity: 1, bucketHash: BUCKET_HASHES.kinetic, location: 1, transferStatus: 1, state: 0 },
            { itemHash: HASH.sunbreaker, itemInstanceId: 's1', quantity: 1, bucketHash: BUCKET_HASHES.subclass, location: 1, transferStatus: 1, state: 0 },
          ],
        },
        [HUNTER_ID]: {
          items: [
            { itemHash: HASH.wildwoodVest, itemInstanceId: 'a3', quantity: 1, bucketHash: BUCKET_HASHES.chest, location: 1, transferStatus: 1, state: 0 },
          ],
        },
      },
    },
    characterInventories: {
      data: {
        [TITAN_ID]: {
          items: [
            { itemHash: HASH.linecutter, itemInstanceId: 'w3', quantity: 1, bucketHash: BUCKET_HASHES.power, location: 1, transferStatus: 0, state: 0 },
          ],
        },
        [HUNTER_ID]: { items: [] },
      },
    },
    profileProgression: {
      data: {
        seasonalArtifact: {
          artifactHash: HASH.artifact,
          pointProgression: prog(),
          pointsAcquired: 10,
          powerBonusProgression: prog(),
          powerBonus: 15,
        },
      },
    },
    characterProgressions: {
      data: {
        [TITAN_ID]: {
          seasonalArtifact: {
            artifactHash: HASH.artifact,
            pointsUsed: 3,
            resetCount: 0,
            tiers: [
              {
                tierHash: 60111,
                isUnlocked: true,
                pointsToUnlock: 1,
                items: [
                  { itemHash: HASH.artAntiBarrier, isActive: true, isVisible: true },
                  { itemHash: HASH.artUnstoppable, isActive: false, isVisible: true },
                ],
              },
              {
                tierHash: 60112,
                isUnlocked: true,
                pointsToUnlock: 2,
                items: [
                  { itemHash: HASH.artOverload, isActive: true, isVisible: true },
                  { itemHash: HASH.artSolarFlare, isActive: false, isVisible: true },
                ],
              },
              {
                tierHash: 60113,
                isUnlocked: false,
                pointsToUnlock: 3,
                items: [{ itemHash: HASH.artArgent, isActive: false, isVisible: true }],
              },
            ],
          },
        },
      },
    },
    profilePlugSets: {
      data: {
        plugs: {
          [HASH.plugSetFragments]: [
            plug(HASH.fragTorches),
            plug(HASH.fragSearing),
            plug(HASH.fragWonder),
            plug(HASH.fragAshes),
            plug(HASH.fragLocked, false),
          ],
        },
      },
    },
    characterPlugSets: {
      data: {
        [TITAN_ID]: {
          plugs: {
            [HASH.plugSetAspects]: [
              plug(HASH.aspectSol),
              plug(HASH.aspectRoaring),
              plug(HASH.aspectConsecration),
            ],
          },
        },
      },
    },
    itemComponents: {
      instances: {
        data: {
          w1: { damageTypeHash: DT.solar, primaryStat: { statHash: STAT_HASHES.power, value: 2010 }, isEquipped: false },
          w2: { damageTypeHash: DT.void, primaryStat: { statHash: STAT_HASHES.power, value: 2005 }, isEquipped: true },
          w3: { damageTypeHash: DT.strand, primaryStat: { statHash: STAT_HASHES.power, value: 1980 }, isEquipped: false },
          a1: { primaryStat: { statHash: STAT_HASHES.power, value: 2010 } },
          a2: { primaryStat: { statHash: STAT_HASHES.power, value: 2008 }, isEquipped: true },
          a3: { primaryStat: { statHash: STAT_HASHES.power, value: 1995 }, isEquipped: true },
          s1: { isEquipped: true },
        },
      },
      sockets: {
        data: {
          w1: {
            sockets: [
              socket(HASH.precisionFrame),
              socket(HASH.incandescent),
              socket(HASH.killClip),
              socket(HASH.backupMag),
            ],
          },
          s1: {
            sockets: [
              socket(HASH.supHammer),
              socket(HASH.classTowering),
              socket(HASH.moveHigh),
              socket(HASH.meleeHammer),
              socket(HASH.nadeFusion),
              socket(HASH.aspectSol),
              socket(HASH.aspectRoaring),
              socket(HASH.fragTorches),
              socket(HASH.fragSearing),
              socket(HASH.fragEmpty),
              socket(HASH.fragEmpty),
            ],
          },
        },
      },
      reusablePlugs: {
        data: {
          w1: {
            plugs: {
              '1': [plug(HASH.incandescent), plug(HASH.healClip)],
              '2': [plug(HASH.killClip), plug(HASH.rampage)],
            },
          },
          s1: {
            plugs: {
              '0': [plug(HASH.supHammer), plug(HASH.supBurning)],
              '1': [plug(HASH.classTowering), plug(HASH.classRally)],
              '2': [plug(HASH.moveHigh), plug(HASH.moveStrafe)],
              '3': [plug(HASH.meleeHammer), plug(HASH.meleeStrike)],
              '4': [plug(HASH.nadeFusion), plug(HASH.nadeIncendiary)],
            },
          },
        },
      },
      stats: {
        data: {
          w1: { stats: { [HASH.statRpm]: { statHash: HASH.statRpm, value: 140 } } },
          a1: {
            stats: {
              [HASH.statWeapons]: { statHash: HASH.statWeapons, value: 16 },
              [HASH.statHealth]: { statHash: HASH.statHealth, value: 10 },
            },
          },
        },
      },
    },
  };
}
