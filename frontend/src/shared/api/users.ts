import { Pokemon } from '../../types';
import axios from 'axios';

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
		win: 18,
		loss: 7,
		mmr: 1695,
		games_played: 25,
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
		win: 15,
		loss: 10,
		mmr: 1582,
		games_played: 25,
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
		win: 12,
		loss: 13,
		mmr: 1509,
		games_played: 25,
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
		win: 9,
		loss: 5,
		mmr: 1590,
		games_played: 14,
		most_drafted_pokemon: [
			{ id: 196, name: 'Espeon', form: '' },
			{ id: 172, name: 'Pichu', form: '' },
			{ id: 1, name: 'Bulbasaur', form: '' },
		],
	},
	{
		user_id: 'user-005',
		username: 'GengarGrin',
		win: 7,
		loss: 2,
		mmr: 1550,
		games_played: 9,
		most_drafted_pokemon: [
			{ id: 92, name: 'Gastly', form: '' },
			{ id: 471, name: 'Glaceon', form: '' },
			{ id: 714, name: 'Noibat', form: '' },
		],
	},
	{
		user_id: 'user-006',
		username: 'SnorlaxSnacker',
		win: 4,
		loss: 4,
		mmr: 1490,
		games_played: 8,
		most_drafted_pokemon: [
			{ id: 216, name: 'Teddiursa', form: '' },
			{ id: 446, name: 'Munchlax', form: '' },
			{ id: 134, name: 'Vaporeon', form: '' },
		],
	},
	{
		user_id: 'user-007',
		username: 'EeveeExplorer',
		win: 3,
		loss: 4,
		mmr: 1475,
		games_played: 7,
		most_drafted_pokemon: [
			{ id: 196, name: 'Espeon', form: '' },
			{ id: 280, name: 'Ralts', form: '' },
		],
	},
	{
		user_id: 'user-008',
		username: 'DragonTamer',
		win: 5,
		loss: 1,
		mmr: 1560,
		games_played: 6,
		most_drafted_pokemon: [
			{ id: 696, name: 'Tyrunt', form: '' },
			{ id: 371, name: 'Bagon', form: '' },
		],
	},
	{
		user_id: 'user-009',
		username: 'AquaJetsetter',
		win: 2,
		loss: 3,
		mmr: 1480,
		games_played: 5,
		most_drafted_pokemon: [
			{ id: 7, name: 'Squirtle', form: '' },
			{ id: 320, name: 'Wailmer', form: '' },
		],
	},
	{
		user_id: 'user-010',
		username: 'RockSolid',
		win: 1,
		loss: 3,
		mmr: 1420,
		games_played: 4,
		most_drafted_pokemon: [
			{ id: 74, name: 'Geodude', form: '' },
			{ id: 95, name: 'Onix', form: '' },
		],
	},
	{
		user_id: 'user-011',
		username: 'Nathan’s Haters',
		win: 0,
		loss: 50,
		mmr: 60,
		games_played: 50,
		most_drafted_pokemon: [
			{ id: 664, name: 'Scatterbug', form: '' },
			{ id: 13, name: 'Weedle', form: '' },
		],
	},
	{
		user_id: 'user-012',
		username: 'LilTimmy',
		win: 1,
		loss: 8,
		mmr: 1100,
		games_played: 9,
		most_drafted_pokemon: [
			{ id: 821, name: 'Rookidee', form: '' },
			{ id: 263, name: 'Zigzagoon', form: '' },
		],
	},
	{
		user_id: 'user-013',
		username: 'OneandDone',
		win: 0,
		loss: 1,
		mmr: 1450,
		games_played: 1,
		most_drafted_pokemon: [
			{ id: 172, name: 'Pichu', form: '' },
			{ id: 173, name: 'Cleffa', form: '' },
		],
	},
];

const USE_MOCK_LEADERBOARD_API = true; // Set to false to use real API when available

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
