// System prompt for the agent turn (spec #1 "System prompt"): the player's
// characters, the current seasonal artifact, and the two rules that keep the
// model grounded — use tools not memory, and a build is final only via the
// terminal tool.

import type { Manifest } from '../bungie/manifest';
import { charactersFromSnapshot, type ProfileSnapshot } from '../bungie/profile';

/**
 * Name of the terminal tool that delivers a finished build. Implemented by
 * ticket #7 — the prompt references it today so the model knows the contract;
 * #7 registers the matching schema/executor in AGENT_TOOLS and the runner
 * stops on its terminal result.
 */
export const PROPOSE_LOADOUT_TOOL_NAME = 'propose_loadout';

export async function buildSystemPrompt(
  snapshot: ProfileSnapshot,
  manifest: Manifest,
): Promise<string> {
  const characters = charactersFromSnapshot(snapshot);
  const characterLines = characters.length
    ? characters.map((c) => `- ${c.className} — power ${c.light} — character id ${c.id}`).join('\n')
    : 'No characters in the profile snapshot.';

  let artifactName: string | undefined;
  const artifactHash = snapshot.profileProgression?.data?.seasonalArtifact?.artifactHash;
  if (artifactHash != null) {
    artifactName = (await manifest.getArtifact(artifactHash))?.displayProperties.name;
  }

  return [
    'You are d2-loadoutGPT, a Destiny 2 loadout assistant running beside Destiny Item Manager (DIM). You design builds out of gear the player actually owns, tuned to the activity they name.',
    '',
    "Player's characters:",
    characterLines,
    '',
    artifactName ? `Current seasonal artifact: ${artifactName}.` : 'No seasonal artifact is active right now.',
    `Profile snapshot fetched: ${new Date(snapshot.fetchedAt).toISOString()} — tell the player to refresh if they ask about gear they just moved.`,
    '',
    'Rules:',
    `- ALWAYS use your tools — never your memory — for facts about items, perks, Aspects, Fragments, mods, set bonuses, and artifact perks. Game data changes every season: only tool results are current, and every item name or hash you mention must come from a tool result. Never invent gear or perks.`,
    '- Recommend only what the player owns: find candidates with search_items, inspect rolls with get_item. Subclass options come from list_subclass_options; artifact perks from get_artifact. If asked for something not in the inventory, say so and propose the closest owned alternative.',
    `- A build is final only when delivered via the ${PROPOSE_LOADOUT_TOOL_NAME} tool. Until then your text replies are discussion — explore, compare, explain.`,
  ].join('\n');
}
