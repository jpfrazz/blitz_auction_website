import { Pokemon } from '../../types';

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
		username: 'EmeraldAce',
		win: 18,
		loss: 7,
		mmr: 1675,
		games_played: 25,
		most_drafted_pokemon: [
			{ id: 79, name: 'Slowpoke', form: 'Galar' },
			{ id: 297, name: 'Hariyama', form: '' },
			{ id: 310, name: 'Manectric', form: '' },
			{ id: 730, name: 'Primarina', form: '' },
			{ id: 655, name: 'Delphox', form: '' },
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
			{ id: 171, name: 'Lanturn', form: '' },
			{ id: 706, name: 'Goodra', form: 'Hisui' },
			{ id: 593, name: 'Jellicent', form: '' },
			{ id: 681, name: 'Aegislash-Shield', form: 'Shield' },
			{ id: 398, name: 'Staraptor', form: '' },
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
			{ id: 514, name: 'Simisear', form: '' },
			{ id: 839, name: 'Coalossal', form: '' },
			{ id: 297, name: 'Hariyama', form: '' },
			{ id: 445, name: 'Garchomp', form: '' },
			{ id: 571, name: 'Zoroark', form: '' },
		],
	},
];

const USE_MOCK_LEADERBOARD_API = true;

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
	if (USE_MOCK_LEADERBOARD_API) {
		return Promise.resolve(mockLeaderboardData);
	}

	// Swap to backend endpoint when available.
	// Example expected route: GET /api/leaderboard
	const response = await fetch('/api/leaderboard', {
		method: 'GET',
		credentials: 'include',
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
	}

	return response.json();
}
