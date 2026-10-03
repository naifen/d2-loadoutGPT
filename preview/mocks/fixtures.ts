// Shared canned content for the preview mocks: one finished proposal plus a
// wire history that rebuilds into user / activity / proposal / assistant rows.

import type { ChatMessage } from '../../src/agent/transport';
import type { LoadoutProposal } from '../../src/agent/proposal';

export const PREVIEW_PROPOSAL: LoadoutProposal = {
  name: 'Sunbreaker — GM Nightfall (Solar Titan)',
  url: 'https://app.destinyitemmanager.com/loadouts?loadout=eyJjbGFzcyI6MX0',
  query: 'id:6917529091 id:6917529104 id:6917529337 id:6917529402',
  card: [
    '## Sunbreaker — GM Nightfall',
    '',
    '**Weapons**',
    '',
    '- **Kinetic** — The Palindrome (Adept), Kinetic slot',
    '- **Energy** — Sunlit Resolve, Solar Fusion Rifle',
    '- **Power** — Gjallarhorn, Exotic Rocket Launcher',
    '',
    '**Armor** *(all Solar)*',
    '',
    '- Loreley Splendor Helm *(Exotic)* — Sunspot on cast',
    '- Gauntlets of the Exile — 100 Resilience roll',
    '- Chest of the Exile — Solar reserves x2',
    '- Boots of the Exile — Recuperation',
    '- Mark of the Exile — Bomber x2',
    '',
    '**Subclass** — Solar · Consecration, Sol Invictus, Roaring Flames x3',
    '',
    '**Mods** — Elemental Charge, Font of Might, Solar Weapon Surge x2, Time Dilation',
    '',
    '**Why it works** — Loreley + Sol Invictus double-dips on sunspots for',
    'survivability inside GM damage ranges; Gjallarhorn covers champions',
    'without giving up Solar surge stacking.',
  ].join('\n'),
};

export const PREVIEW_HISTORY: ChatMessage[] = [
  {
    role: 'user',
    content: 'Build me a Solar Titan for Grandmaster Nightfalls — I want Loreley Splendor and Gjallarhorn.',
  },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_01', type: 'function', function: { name: 'get_characters', arguments: '{}' } },
      {
        id: 'call_02',
        type: 'function',
        function: { name: 'search_items', arguments: '{"classType":0,"damageType":"solar"}' },
      },
      { id: 'call_03', type: 'function', function: { name: 'list_subclass_options', arguments: '{}' } },
      { id: 'call_04', type: 'function', function: { name: 'propose_loadout', arguments: '{}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_01', content: '{"characters":[]}' },
  { role: 'tool', tool_call_id: 'call_02', content: '{"items":[]}' },
  { role: 'tool', tool_call_id: 'call_03', content: '{"aspects":[]}' },
  { role: 'tool', tool_call_id: 'call_04', content: JSON.stringify(PREVIEW_PROPOSAL) },
  {
    role: 'assistant',
    content:
      'Done — the build card above is your GM-ready Sunbreaker. Open it in DIM to review before applying, or copy the id: query to highlight the pieces in your vault.',
  },
];
