import type { StatsPagePlayer, StatsPageTeamRow } from '../../types';

export interface OpponentProfileLink {
  teamId: number;
  userId: string;
  name: string;
}

/**
 * Every account that represents the selected player. Profiles can include
 * linked guest accounts, so all of those identities must be excluded when
 * finding the other teams in a race.
 */
export function getSelectedPlayerIdentityIds(
  selectedPlayer: StatsPagePlayer | null,
  players: StatsPagePlayer[],
): Set<string> {
  if (!selectedPlayer) return new Set<string>();

  const primaryId = selectedPlayer.is_guest && selectedPlayer.linked_user_id
    ? selectedPlayer.linked_user_id
    : selectedPlayer.user_id;
  const ids = new Set<string>([selectedPlayer.user_id, primaryId]);

  players.forEach((player) => {
    if (player.linked_user_id === primaryId || player.linked_user_id === selectedPlayer.user_id) {
      ids.add(player.user_id);
    }
  });

  return ids;
}

/**
 * Builds the "Vs. ..." links for each draft from the global stats team list.
 * Linked guest teams resolve to their registered profile and duplicate
 * identities in the same race are collapsed into one link.
 */
export function buildOpponentsByDraftId(
  teams: StatsPageTeamRow[],
  players: StatsPagePlayer[],
  selectedPlayerIdentityIds: Set<string>,
): Map<string, OpponentProfileLink[]> {
  const result = new Map<string, OpponentProfileLink[]>();
  const playersById = new Map(players.map((player) => [player.user_id, player]));

  const resolveProfile = (playerId: string): { userId: string; name: string } => {
    const player = playersById.get(playerId);
    if (!player) return { userId: playerId, name: playerId };

    const linked = player.is_guest && player.linked_user_id
      ? playersById.get(player.linked_user_id)
      : undefined;
    const profile = linked ?? player;

    return {
      userId: profile.user_id,
      name: profile.global_name || profile.user_name || profile.user_id,
    };
  };

  teams.forEach((team) => {
    const playerId = team.user_id ?? team.guest_id;
    if (!playerId || selectedPlayerIdentityIds.has(playerId)) return;

    const profile = resolveProfile(playerId);
    if (selectedPlayerIdentityIds.has(profile.userId)) return;

    const opponents = result.get(team.draft_id) ?? [];
    if (!opponents.some((opponent) => opponent.userId === profile.userId)) {
      opponents.push({ teamId: team.team_id, ...profile });
      result.set(team.draft_id, opponents);
    }
  });

  result.forEach((opponents) => opponents.sort((a, b) => a.name.localeCompare(b.name)));
  return result;
}
