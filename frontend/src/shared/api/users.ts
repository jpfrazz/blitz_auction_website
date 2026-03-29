import axios, {AxiosError} from 'axios';
import {
  AdminDiscordUser,
  AdminDraftSummary,
  AdminDraftTeamPlacement,
  AdminTeamPlacementUpdate,
  Pokemon,
} from "../../types";

export interface LeaderboardEntry {
	user_id: string;
	username: string;
	win: number;
	loss: number;
	mmr: number;
	games_played: number;
	most_drafted_pokemon: Pokemon[];
}

const mockLeaderboardData: LeaderboardEntry[] = [
	{
		user_id: 'user-001',
		username: 'FranklyNathan',
		win: 52,
		loss: 18,
		mmr: 1695,
		games_played: 10,
		most_drafted_pokemon: [
			{ id: 700, name: 'Sylveon', form: '' },
			{ id: 296, name: 'Makuhita', form: '' },
			{ id: 309, name: 'Electrike', form: '' },
			{ id: 728, name: 'Popplio', form: '' },
			{ id: 653, name: 'Fennekin', form: '' },
		],
	},
	{
		user_id: 'user-002',
		username: 'Route119Rain',
		win: 38,
		loss: 18,
		mmr: 1582,
		games_played: 8,
		most_drafted_pokemon: [
			{ id: 170, name: 'Chinchou', form: '' },
			{ id: 704, name: 'Goomy', form: '' },
			{ id: 592, name: 'Frillish', form: '' },
			{ id: 679, name: 'Honedge', form: '' },
			{ id: 471, name: 'Glaceon', form: '' },
		],
	},
	{
		user_id: 'user-003',
		username: 'StoneBadgeEnjoyer',
		win: 20,
		loss: 22,
		mmr: 1509,
		games_played: 6,
		most_drafted_pokemon: [
			{ id: 513, name: 'Pansear', form: '' },
			{ id: 837, name: 'Rolycoly', form: '' },
			{ id: 296, name: 'Makuhita', form: '' },
			{ id: 443, name: 'Gible', form: '' },
			{ id: 570, name: 'Zorua', form: '' },
		],
	},
	{
		user_id: 'user-004',
		username: 'PikaPal',
		win: 25,
		loss: 10,
		mmr: 1590,
		games_played: 5,
		most_drafted_pokemon: [
			{ id: 196, name: 'Espeon', form: '' },
			{ id: 172, name: 'Pichu', form: '' },
			{ id: 1, name: 'Bulbasaur', form: '' },
		],
	},
	{
		user_id: 'user-005',
		username: 'GengarGrin',
		win: 16,
		loss: 5,
		mmr: 1550,
		games_played: 3,
		most_drafted_pokemon: [
			{ id: 92, name: 'Gastly', form: '' },
			{ id: 471, name: 'Glaceon', form: '' },
			{ id: 714, name: 'Noibat', form: '' },
		],
	},
	{
		user_id: 'user-006',
		username: 'SnorlaxSnacker',
		win: 7,
		loss: 7,
		mmr: 1490,
		games_played: 2,
		most_drafted_pokemon: [
			{ id: 216, name: 'Teddiursa', form: '' },
			{ id: 446, name: 'Munchlax', form: '' },
			{ id: 134, name: 'Vaporeon', form: '' },
		],
	},
	{
		user_id: 'user-007',
		username: 'EeveeExplorer',
		win: 6,
		loss: 8,
		mmr: 1475,
		games_played: 2,
		most_drafted_pokemon: [
			{ id: 196, name: 'Espeon', form: '' },
			{ id: 280, name: 'Ralts', form: '' },
		],
	},
	{
		user_id: 'user-008',
		username: 'DragonTamer',
		win: 6,
		loss: 1,
		mmr: 1560,
		games_played: 1,
		most_drafted_pokemon: [
			{ id: 696, name: 'Tyrunt', form: '' },
			{ id: 371, name: 'Bagon', form: '' },
		],
	},
	{
		user_id: 'user-009',
		username: 'AquaJetsetter',
		win: 3,
		loss: 4,
		mmr: 1480,
		games_played: 1,
		most_drafted_pokemon: [
			{ id: 7, name: 'Squirtle', form: '' },
			{ id: 320, name: 'Wailmer', form: '' },
		],
	},
	{
		user_id: 'user-010',
		username: 'RockSolid',
		win: 1,
		loss: 6,
		mmr: 1420,
		games_played: 1,
		most_drafted_pokemon: [
			{ id: 74, name: 'Geodude', form: '' },
			{ id: 95, name: 'Onix', form: '' },
		],
	},
	{
		user_id: 'user-011',
		username: 'Nathan’s Haters',
		win: 0,
		loss: 70,
		mmr: 60,
		games_played: 10,
		most_drafted_pokemon: [
			{ id: 664, name: 'Scatterbug', form: '' },
			{ id: 13, name: 'Weedle', form: '' },
		],
	},
	{
		user_id: 'user-012',
		username: 'LilTimmy',
		win: 2,
		loss: 12,
		mmr: 1100,
		games_played: 2,
		most_drafted_pokemon: [
			{ id: 821, name: 'Rookidee', form: '' },
			{ id: 263, name: 'Zigzagoon', form: '' },
		],
	},
	{
		user_id: 'user-013',
		username: 'OneandDone',
		win: 0,
		loss: 7,
		mmr: 1450,
		games_played: 1,
		most_drafted_pokemon: [
			{ id: 172, name: 'Pichu', form: '' },
			{ id: 173, name: 'Cleffa', form: '' },
		],
	},
];

const USE_MOCK_LEADERBOARD_API = false; // Set to false to use real API when available

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
	if (USE_MOCK_LEADERBOARD_API) {
		return Promise.resolve(mockLeaderboardData);
	}

	// Swap to backend endpoint when available.
	// Example expected route: GET /api/leaderboard
	const response = await axios.get('/api/leaderboard');

	if (response.status !== 200) {
		throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
	}

	return response.data;
}

export async function fetchAdminCompletedDrafts(): Promise<AdminDraftSummary[]> {
  const response = await axios.get('/api/admin/drafts/completed');
  return response.data;
}

export async function fetchAdminDraftTeamPlacements(draft_id: string): Promise<AdminDraftTeamPlacement[]> {
  const response = await axios.get(`/api/admin/drafts/${draft_id}/teams`);
  return response.data;
}

export async function updateAdminDraftPlacements(
  draft_id: string,
  placements: AdminTeamPlacementUpdate[],
): Promise<void> {
  await axios.post(`/api/admin/drafts/${draft_id}/teams/update-placements`, { placements });
}

export async function fetchAdminDiscordUsers(): Promise<AdminDiscordUser[]> {
  const response = await axios.get('/api/admin/users');
  return response.data;
}

export async function updateAdminDiscordUser(
  user_id: string,
  payload: { mmr: number; wins: number; losses: number },
): Promise<void> {
  await axios.post(`/api/admin/users/${user_id}/update`, payload);
}
