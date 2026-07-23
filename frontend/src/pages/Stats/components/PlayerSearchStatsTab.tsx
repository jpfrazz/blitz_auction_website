import React, { useEffect, useMemo, useState } from 'react';
import { fetchMatchHistoryByUserId, fetchBossBattleHistory, BossBattleHistoryEntry } from '../../../shared/api/stats';
import { MatchHistoryTeam, StatsAuction, StatsPagePlayer, StatsPageResponse } from '../../../types';
import type { PlayerStatPill } from './playerStatPills';
import { getPlayerStatPills } from './playerStatPills';
import '../Stats.scss';
import './PlayerSearchStatsTab.scss';

interface PlayerSearchStatsTabProps {
  stats: StatsPageResponse | null;
  loading?: boolean;
  error?: string | null;
  validDraftIds: Set<string>;
}

interface PokemonDraftSummary {
  key: string;
  name: string;
  form: string;
  games: number;
  totalSpend: number;
  avgSpend: number;
}

function formatPokemonName(name: string | undefined): string {
  if (!name) return '';
  const lower = name.toLowerCase();
  if (lower.startsWith("farfetch'd")) {
    return "farfetch'd";
  }
  return lower.replace(/'/g, '');
}

function calculateQuantile(sortedData: number[], q: number) {
  const pos = (sortedData.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedData[base + 1] !== undefined) {
    return sortedData[base] + rest * (sortedData[base + 1] - sortedData[base]);
  }
  return sortedData[base];
}

const formOverrides: Record<string, { form: string; key: string }> = {
  'Wooper': { form: 'Paldea', key: 'Wooper-Paldea' },
  'Vulpix': { form: 'Alola', key: 'Vulpix-Alola' },
  'Voltorb': { form: 'Hisui', key: 'Voltorb-Hisui' },
  "Farfetch'd": { form: 'Galar', key: "Farfetch'd-Galar" },
  'Sandshrew': { form: 'Alola', key: 'Sandshrew-Alola' },
  'Meowth': { form: 'Galar', key: 'Meowth-Galar' },
  'Slowpoke': { form: 'Galar', key: 'Slowpoke-Galar' },
  'Zigzagoon': { form: 'Galar', key: 'Zigzagoon-Galar' },
};

const resolveIdentity = (name: string, form: string) => {
  let currentName = name;
  let currentForm = form;

  const knownForms = ['Alola', 'Galar', 'Hisui', 'Paldea'];
  for (const f of knownForms) {
    if (currentName.endsWith(`-${f}`)) {
      currentName = currentName.slice(0, -(f.length + 1));
      currentForm = f;
      break;
    }
  }

  if ((!currentForm || currentForm === 'base') && formOverrides[currentName]) {
    return { name: currentName, ...formOverrides[currentName] };
  }
  const effectiveForm = currentForm && currentForm !== 'base' ? currentForm : '';
  const key = `${currentName}${effectiveForm ? '-' + effectiveForm : ''}`;
  return { name: currentName, form: effectiveForm, key };
};

function getPlacementLabel(placement: number | null, isRanked: boolean): string {
  if (!isRanked || placement === null) {
    return 'Normal';
  }

  const suffix = placement % 10 === 1 && placement % 100 !== 11
    ? 'st'
    : placement % 10 === 2 && placement % 100 !== 12
      ? 'nd'
      : placement % 10 === 3 && placement % 100 !== 13
        ? 'rd'
        : 'th';

  return `Ranked: ${placement}${suffix}`;
}

function getPlacementClass(placement: number | null, isRanked: boolean): string {
  if (!isRanked || placement === null || placement > 3) {
    return 'normal';
  }

  if (placement === 1) return 'first';
  if (placement === 2) return 'second';
  return 'third';
}

function getPokemonLabel(name: string, form: string): string {
  return form ? `${name} (${form})` : name;
}

// Mapping of trainer IDs to trainer names (from parseSaveFile.ts and opponents.h)
const TRAINER_ID_TO_NAME: Record<number, string> = {
  265: "Roxanne",
  855: "Viola",
  266: "Brawly",
  267: "Wattson",
  268: "Flannery",
  269: "Norman",
  270: "Winona",
  271: "Tate & Liza",
  272: "Juan & Wallace",
  601: "Maxie",
  34: "Archie",
  261: "Sidney",
  262: "Phoebe",
  263: "Glacia",
  264: "Drake",
  806: "Tucker",
  807: "Spenser",
  810: "Lucy",
  811: "Brandon",
  804: "Steven",
  656: "Wally",
  // Gym leader versions from opponents.h
  770: "Roxanne 2",
  771: "Roxanne 3",
  772: "Roxanne 4",
  773: "Roxanne 5",
  812: "Roxanne 6",
  813: "Roxanne 7",
  814: "Roxanne 8",
  774: "Brawly 2",
  775: "Brawly 3",
  776: "Brawly 4",
  777: "Brawly 5",
  815: "Brawly 6",
  816: "Brawly 7",
  817: "Brawly 8",
  778: "Wattson 2",
  779: "Wattson 3",
  780: "Wattson 4",
  781: "Wattson 5",
  818: "Wattson 6",
  819: "Wattson 7",
  820: "Wattson 8",
  782: "Flannery 2",
  783: "Flannery 3",
  784: "Flannery 4",
  785: "Flannery 5",
  821: "Flannery 6",
  822: "Flannery 7",
  823: "Flannery 8",
  786: "Norman 2",
  787: "Norman 3",
  788: "Norman 4",
  789: "Norman 5",
  824: "Norman 6",
  825: "Norman 7",
  826: "Norman 8",
  790: "Winona 2",
  791: "Winona 3",
  792: "Winona 4",
  793: "Winona 5",
  827: "Winona 6",
  828: "Winona 7",
  829: "Winona 8",
  794: "Tate & Liza 2",
  795: "Tate & Liza 3",
  796: "Tate & Liza 4",
  797: "Tate & Liza 5",
  830: "Tate & Liza 6",
  831: "Tate & Liza 7",
  832: "Tate & Liza 8",
  798: "Juan & Wallace 2",
  799: "Juan & Wallace 3",
  800: "Juan & Wallace 4",
  801: "Juan & Wallace 5",
  833: "Juan & Wallace 6",
  834: "Juan & Wallace 7",
  835: "Juan & Wallace 8",
  856: "Viola 2",
  857: "Viola 3",
  858: "Viola 4",
  859: "Viola 5",
  860: "Viola 6",
  861: "Viola 7",
  862: "Viola 8",
};

function getTrainerNameById(trainerId: number, version?: number | null): string {
  const baseName = TRAINER_ID_TO_NAME[trainerId] || `Trainer #${trainerId}`;

  // If the trainer ID is already mapped with a version number (e.g., 801 = "Juan & Wallace 5"),
  // return it directly without appending another version
  if (/\d$/.test(baseName)) {
    return baseName;
  }

  if (version !== undefined && version !== null && version > 0) {
    return `${baseName} ${version}`;
  }
  return baseName;
}

function getBossBattleVictory(battles: BossBattleHistoryEntry[] | undefined): string | null {
  if (!battles || battles.length === 0) return null;

  // Check for Steven (804) or Wally (656) wins (not losses)
  const stevenWin = battles.find(b => b.trainer_id === 804 && !b.is_loss);
  const wallyWin = battles.find(b => b.trainer_id === 656 && !b.is_loss);

  const formatTime = (hours: number, minutes: number, seconds: number) => {
    return `${hours > 0 ? `${hours}h ` : ''}${minutes}m ${seconds}s`;
  };

  if (stevenWin) {
    return `Beat Steven (${formatTime(stevenWin.hours, stevenWin.minutes, stevenWin.seconds)})`;
  }
  if (wallyWin) {
    return `Beat Wally (${formatTime(wallyWin.hours, wallyWin.minutes, wallyWin.seconds)})`;
  }

  return null;
}

function getRunResult(battles: BossBattleHistoryEntry[]): { result: string; trainer: string; isWin: boolean } | null {
  if (!battles || battles.length === 0) return null;

  const lastBattle = battles[battles.length - 1];

  // Check if it's a win (Steven/Wally are the final bosses)
  if (lastBattle.trainer_id === 816 || lastBattle.trainer_id === 817) {
    return {
      result: 'Beat',
      trainer: lastBattle.trainer_id === 816 ? 'Steven' : 'Wally',
      isWin: true,
    };
  }

  // Otherwise it's a wipe - find the trainer that caused the wipe
  if (lastBattle.is_loss) {
    return {
      result: 'Wiped to',
      trainer: getTrainerNameById(lastBattle.trainer_id, lastBattle.version),
      isWin: false,
    };
  }

  return null;
}

const PlayerSearchStatsTab: React.FC<PlayerSearchStatsTabProps> = ({
  stats,
  loading = false,
  error = null,
  validDraftIds,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<StatsPagePlayer | null>(null);
  const [playerMatchHistory, setPlayerMatchHistory] = useState<MatchHistoryTeam[] | null>(null);
  const [playerMatchHistoryLoading, setPlayerMatchHistoryLoading] = useState(false);
  const [playerMatchHistoryError, setPlayerMatchHistoryError] = useState<string | null>(null);
  const [bossBattleHistory, setBossBattleHistory] = useState<Map<number, BossBattleHistoryEntry[]>>(new Map());
  const [bossBattleHistoryLoading, setBossBattleHistoryLoading] = useState(false);

  const filteredPlayers = useMemo(() => {
    if (!searchInput.trim() || !stats?.players) {
      return [];
    }
    const query = searchInput.toLowerCase();
    return stats.players
      .filter((player) => !player.is_guest)
      .filter((player) => player.user_name.toLowerCase().includes(query))
      .slice(0, 10);
  }, [searchInput, stats?.players]);

  const filteredMatchHistory = useMemo(() => {
    if (!playerMatchHistory) return null;
    return playerMatchHistory.filter(team => validDraftIds.has(team.draft_id));
  }, [playerMatchHistory, validDraftIds]);

  const playerGamesMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!stats) return map;
    stats.teams.forEach((team) => {
      const id = team.user_id || team.guest_id;
      if (id && validDraftIds.has(team.draft_id)) {
        map.set(id, (map.get(id) || 0) + 1);
      }
    });
    return map;
  }, [stats, validDraftIds]);

  const draftDateMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!stats?.auctions) return map;
    stats.auctions.forEach(a => {
      if (a.created_at && !map.has(a.draft_id)) {
        map.set(a.draft_id, new Date(a.created_at).toLocaleDateString());
      }
    });
    return map;
  }, [stats?.auctions]);

  const topPlayers = useMemo(() => {
    if (!stats?.players) return [];
    return stats.players
      .filter((p) => !p.is_guest)
      .map((p) => ({ ...p, gamesPlayed: playerGamesMap.get(p.user_id) || 0 }))
      .filter((p) => p.gamesPlayed > 0)
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
      .slice(0, 40);
  }, [stats?.players, playerGamesMap]);

  const pokemonDraftSummary = useMemo<PokemonDraftSummary[]>(() => {
    if (!filteredMatchHistory?.length) {
      return [];
    }

    const summary = new Map<string, PokemonDraftSummary>();

    filteredMatchHistory.forEach((team) => {
      // Count pokemon from any valid draft

      (team.pokemon_drafted ?? []).forEach((auction) => {
        const key = `${auction.name}::${auction.form}`;
        const existing = summary.get(key);

        if (existing) {
          existing.games += 1;
          existing.totalSpend += auction.winning_bid ?? 0;
          existing.avgSpend = existing.games === 0 ? 0 : existing.totalSpend / existing.games;
          return;
        }

        summary.set(key, {
          key,
          name: auction.name,
          form: auction.form,
          games: 1,
          totalSpend: auction.winning_bid ?? 0,
          avgSpend: auction.winning_bid ?? 0,
        });
      });
    });

    return Array.from(summary.values()).sort((left, right) => {
      if (right.games !== left.games) {
        return right.games - left.games;
      }

      return getPokemonLabel(left.name, left.form).localeCompare(getPokemonLabel(right.name, right.form));
    });
  }, [filteredMatchHistory]);

  const featuredPokemon = pokemonDraftSummary[0] ?? null;

  const personalBestTime = useMemo(() => {
    let bestSeconds = Infinity;
    bossBattleHistory.forEach((battles) => {
      battles.forEach((b) => {
        if (b.is_loss) return;
        if (b.trainer_id !== 804 && b.trainer_id !== 656) return;
        const total = b.hours * 3600 + b.minutes * 60 + b.seconds;
        if (total < bestSeconds) bestSeconds = total;
      });
    });
    if (bestSeconds === Infinity) return null;
    const h = Math.floor(bestSeconds / 3600);
    const m = Math.floor((bestSeconds % 3600) / 60);
    const s = bestSeconds % 60;
    return `${h > 0 ? `${h}h ` : ''}${m}m ${s}s`;
  }, [bossBattleHistory]);

  const totalGames = filteredMatchHistory?.length ?? 0;

  const globalPokemonPrices = useMemo(() => {
    const map = new Map<string, number>();
    if (!stats?.auctions) return map;

    const grouped = new Map<string, number[]>();
    stats.auctions.forEach((auction) => {
      if (auction.winning_bid === null) return;
      if (!validDraftIds.has(auction.draft_id)) return;
      const { key } = resolveIdentity(auction.name, auction.form || '');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(auction.winning_bid);
    });

    (stats.legacy ?? []).forEach((legacyRow) => {
      const normalized = legacyRow.cost.trim().replace(/,/g, '');
      if (!/^\d+$/.test(normalized)) return;
      const bid = Number(normalized);
      const { key } = resolveIdentity(legacyRow.pokemon, '');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(bid);
    });

    grouped.forEach((bids, key) => {
      let filtered = bids.filter((b) => b !== 100);
      if (filtered.length > 1) {
        const sorted = [...filtered].sort((a, b) => a - b);
        const q1 = calculateQuantile(sorted, 0.25);
        const q3 = calculateQuantile(sorted, 0.75);
        const iqr = q3 - q1;
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 2.0 * iqr;
        filtered = sorted.filter((b) => b >= lower && b <= upper);
      }
      if (filtered.length === 0) return;
      const sum = filtered.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / filtered.length);
      if (avg > 100) map.set(key, avg);
    });

    return map;
  }, [stats?.auctions, stats?.legacy, validDraftIds]);

  interface AllPokemonRow {
    key: string;
    name: string;
    form: string;
    playerGames: number;
    appearances: number;
    pctDrafted: number | null;
    avgPaid: number | null;
    avgPrice: number | null;
    diff: number | null;
  }

  const allPokemonList = useMemo<AllPokemonRow[]>(() => {
    const playerMap = new Map<string, PokemonDraftSummary>();
    pokemonDraftSummary.forEach((p) => {
      const { key } = resolveIdentity(p.name, p.form);
      playerMap.set(key, p);
    });

    // For each pokemon, the set of draft_ids where it was auctioned
    const pokemonDraftAppearances = new Map<string, Set<string>>();
    stats?.auctions.forEach((auction) => {
      if (!validDraftIds.has(auction.draft_id)) return;
      const { key } = resolveIdentity(auction.name, auction.form || '');
      if (!pokemonDraftAppearances.has(key)) pokemonDraftAppearances.set(key, new Set());
      pokemonDraftAppearances.get(key)!.add(auction.draft_id);
    });

    // Set of draft_ids the player participated in
    const playerDraftIds = new Set(filteredMatchHistory?.map((t) => t.draft_id) ?? []);

    const globalPokemonKeys = new Map<string, { name: string; form: string }>();
    stats?.auctions.forEach((auction) => {
      if (!validDraftIds.has(auction.draft_id)) return;
      const { key, name, form } = resolveIdentity(auction.name, auction.form || '');
      if (!globalPokemonKeys.has(key)) globalPokemonKeys.set(key, { name, form });
    });

    const rows: AllPokemonRow[] = [];
    globalPokemonKeys.forEach(({ name, form }, key) => {
      const player = playerMap.get(key);
      const avgPrice = globalPokemonPrices.get(key) ?? null;
      const avgPaid = player ? Math.round(player.avgSpend) : null;
      const diff = avgPaid !== null && avgPrice !== null ? avgPaid - avgPrice : null;

      const draftSets = pokemonDraftAppearances.get(key);
      const appearances = draftSets ? Array.from(draftSets).filter((id) => playerDraftIds.has(id)).length : 0;
      const timesDrafted = player?.games ?? 0;
      const pctDrafted = appearances > 0 ? Math.round((timesDrafted / appearances) * 100) : null;

      rows.push({
        key,
        name,
        form,
        playerGames: timesDrafted,
        appearances,
        pctDrafted,
        avgPaid,
        avgPrice,
        diff,
      });
    });

    rows.sort((a, b) => {
      if (b.playerGames !== a.playerGames) return b.playerGames - a.playerGames;
      return getPokemonLabel(a.name, a.form).localeCompare(getPokemonLabel(b.name, b.form));
    });

    return rows;
  }, [pokemonDraftSummary, stats?.auctions, validDraftIds, globalPokemonPrices, filteredMatchHistory]);

  const signaturePokemon = useMemo(() => {
    const candidates = allPokemonList.filter((p) => p.pctDrafted !== null && p.pctDrafted > 0);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, p) => (p.pctDrafted! > best.pctDrafted! ? p : best), candidates[0]);
  }, [allPokemonList]);

  type TableSortKey = 'name' | 'playerGames' | 'appearances' | 'pctDrafted' | 'avgPaid' | 'avgPrice' | 'diff';
  const [tableSortConfig, setTableSortConfig] = useState<{ key: TableSortKey; direction: 'asc' | 'desc' }>({ key: 'playerGames', direction: 'desc' });

  const handleTableSort = (key: TableSortKey) => {
    setTableSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortedPokemonList = useMemo(() => {
    const sorted = [...allPokemonList];
    const { key, direction } = tableSortConfig;
    const mult = direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (key) {
        case 'name':
          return mult * getPokemonLabel(a.name, a.form).localeCompare(getPokemonLabel(b.name, b.form));
        case 'playerGames':
          return mult * (a.playerGames - b.playerGames);
        case 'appearances':
          return mult * (a.appearances - b.appearances);
        case 'pctDrafted':
          return mult * ((a.pctDrafted ?? -1) - (b.pctDrafted ?? -1));
        case 'avgPaid':
          return mult * ((a.avgPaid ?? -Infinity) - (b.avgPaid ?? -Infinity));
        case 'avgPrice':
          return mult * ((a.avgPrice ?? -Infinity) - (b.avgPrice ?? -Infinity));
        case 'diff':
          return mult * ((a.diff ?? -Infinity) - (b.diff ?? -Infinity));
        default:
          return 0;
      }
    });

    return sorted;
  }, [allPokemonList, tableSortConfig]);

  const handleSelectPlayer = async (player: StatsPagePlayer) => {
    setIsAutocompleteOpen(false);
    setExpandedTeamId(null);
    setSelectedPlayer(player);
    setSearchInput(player.user_name);
    setTableSortConfig({ key: 'playerGames', direction: 'desc' });
    setPlayerMatchHistoryLoading(true);
    setPlayerMatchHistoryError(null);

    try {
      const history = await fetchMatchHistoryByUserId(player.user_id);
      setPlayerMatchHistory(history);

      // Fetch boss battle history for all teams
      const bossHistoryMap = new Map<number, BossBattleHistoryEntry[]>();
      await Promise.all(
        history.map(async (team) => {
          try {
            const battles = await fetchBossBattleHistory(team.draft_id, player.user_id);
            bossHistoryMap.set(team.team_id, battles);
          } catch (e) {
            console.error('[PlayerSearchStatsTab] Error fetching boss battle history for team:', team.team_id, e);
          }
        })
      );
      setBossBattleHistory(bossHistoryMap);
    } catch (e: any) {
      console.error('[PlayerSearchStatsTab] Error fetching player match history:', e);
      setPlayerMatchHistoryError('Failed to load player match history.');
    } finally {
      setPlayerMatchHistoryLoading(false);
    }
  };

  const handleSubmitSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedInput = searchInput.trim().toLowerCase();
    const selectedMatch = filteredPlayers.find(
      (player) => player.user_name.trim().toLowerCase() === normalizedInput,
    ) ?? filteredPlayers[0];

    if (!selectedMatch) {
      setIsAutocompleteOpen(false);
      return;
    }

    await handleSelectPlayer(selectedMatch);
  };

  const toggleExpandedTeam = async (teamId: number, draftId: string) => {
    const isExpanding = expandedTeamId !== teamId;
    setExpandedTeamId((current) => current === teamId ? null : teamId);

    if (isExpanding) {
      setBossBattleHistoryLoading(true);
      try {
        const history = await fetchBossBattleHistory(draftId, selectedPlayer?.user_id);
        setBossBattleHistory(prev => new Map(prev).set(teamId, history));
      } catch (e) {
        console.error('[PlayerSearchStatsTab] Error fetching boss battle history:', e);
      } finally {
        setBossBattleHistoryLoading(false);
      }
    }
  };

  if (loading) {
    return <section className="player-search-stats-tab stats-content-grid">Loading stats...</section>;
  }

  if (error) {
    return (
      <section className="player-search-stats-tab stats-content-grid">
        <div className="match-history-error">{error}</div>
      </section>
    );
  }

  return (
    <section className="player-search-stats-tab stats-content-grid">
      <article className="stats-panel player-search-panel">
        <h2>Player Match History</h2>
        <div className="player-search-wrapper">
          <form className="player-search-form" onSubmit={handleSubmitSearch}>
            <div className="player-search-input-wrapper">
              <input
                type="text"
                className="player-search-input"
                placeholder="Search player name..."
                value={searchInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchInput(val);
                  setIsAutocompleteOpen(true);
                  if (!val.trim()) {
                    setSelectedPlayer(null);
                    setPlayerMatchHistory(null);
                  }
                }}
                onFocus={() => setIsAutocompleteOpen(true)}
              />
              {isAutocompleteOpen && filteredPlayers.length > 0 && (
              <div className="search-autocomplete">
                {filteredPlayers.map((player) => (
                  <div
                    key={player.user_id}
                    className="autocomplete-item"
                    onClick={() => handleSelectPlayer(player)}
                  >
                    {player.global_name || player.user_name}
                  </div>
                ))}
              </div>
              )}
            </div>
          </form>

          {playerMatchHistoryLoading && (
            <div className="match-history-message">Loading match history...</div>
          )}

          {playerMatchHistoryError && (
            <div className="match-history-message error">{playerMatchHistoryError}</div>
          )}

          {!selectedPlayer && !playerMatchHistoryLoading && topPlayers.length > 0 && (
            <div className="player-search-suggestions" style={{ marginTop: '0.3rem' }}>
              <p style={{ opacity: 0.6, fontSize: '1.2rem', marginBottom: '1rem' }}>Active Racers (Top Games Played)</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {topPlayers.map((player) => (
                  <button
                    key={player.user_id}
                    type="button"
                    className="suggestion-item"
                    onClick={() => handleSelectPlayer(player as any)}
                  >
                    {(player as any).avatar ? (
                      <img
                        src={`https://cdn.discordapp.com/avatars/${player.user_id}/${(player as any).avatar}.png`}
                        alt=""
                        style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/generic/DiscordAvatar.png';
                        }}
                      />
                    ) : (
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#333' }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{player.global_name || player.user_name}</span>
                      <span style={{ fontSize: '0.95rem', opacity: 0.7 }}>{player.gamesPlayed} games</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedPlayer && !playerMatchHistoryLoading && filteredMatchHistory && (
            <>
              {pokemonDraftSummary.length > 0 && (
                <div className="player-draft-overview">
                 {featuredPokemon && (
                    <div
                      className="player-draft-overview-background"
                      style={{
                        backgroundImage: `url(/baseforms/${featuredPokemon.name}.png)`,
                      }}
                      aria-hidden="true"
                    />
                  )}

                  <div className="player-draft-overview-content">
                    <div className="player-draft-overview-header">
                      <div>
                        {selectedPlayer && (
                          <div className="player-draft-overview-profile-name" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            {(selectedPlayer as any).avatar && (
                              <img
                                src={`https://cdn.discordapp.com/avatars/${selectedPlayer.user_id}/${(selectedPlayer as any).avatar}.png`}
                                alt=""
                                style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/generic/DiscordAvatar.png';
                                }}
                              />
                            )}
                            <div>
                              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{selectedPlayer.user_name}</div>
                              {selectedPlayer.global_name && <div style={{ fontSize: '1rem', opacity: 0.8 }}>({selectedPlayer.global_name})</div>}
                            </div>
                          </div>
                        )}
                        <div className="player-draft-overview-kickers">
                          <div className="player-draft-overview-kicker-group">
                            <span className="player-draft-overview-kicker">Most Drafted</span>
                            {featuredPokemon && (
                              <h3>{getPokemonLabel(featuredPokemon.name, featuredPokemon.form)}</h3>
                            )}
                          </div>
                          {signaturePokemon && (
                            <div className="player-draft-overview-kicker-group">
                              <span className="player-draft-overview-kicker">Signature Pokemon</span>
                              <h3>{getPokemonLabel(signaturePokemon.name, signaturePokemon.form)} ({signaturePokemon.pctDrafted}%)</h3>
                            </div>
                          )}
                          <div className="player-draft-overview-kicker-group">
                            <span className="player-draft-overview-kicker">Personal Best Time</span>
                            <h3>{personalBestTime ?? '---'}</h3>
                          </div>
                          <div className="player-draft-overview-kicker-group">
                            <span className="player-draft-overview-kicker">Total Games</span>
                            <h3>{totalGames}</h3>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="player-draft-overview-table-wrapper">
                    <div className="player-draft-overview-table">
                      <div className="player-draft-overview-table-header">
                        <span className="sortable" onClick={() => handleTableSort('name')}>
                          Pokemon {tableSortConfig.key === 'name' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('playerGames')}>
                          Games {tableSortConfig.key === 'playerGames' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('appearances')}>
                          Appearances {tableSortConfig.key === 'appearances' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('pctDrafted')}>
                          % Drafted {tableSortConfig.key === 'pctDrafted' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('avgPaid')}>
                          Avg Paid {tableSortConfig.key === 'avgPaid' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('avgPrice')}>
                          Avg Price {tableSortConfig.key === 'avgPrice' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                        <span className="sortable" onClick={() => handleTableSort('diff')}>
                          Diff {tableSortConfig.key === 'diff' ? (tableSortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </div>

                      {sortedPokemonList.map((pokemon) => (
                        <div className="player-draft-overview-row" key={pokemon.key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <img
                                src={`/MiniIcons/${formatPokemonName(pokemon.name)}.png`}
                                alt={pokemon.name}
                                style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                              />
                              <span style={{
                                position: 'absolute',
                                top: '-8px',
                                right: '-8px',
                                background: '#222',
                                color: '#fff',
                                fontSize: '0.8rem',
                                padding: '1px 3px',
                                borderRadius: '3px',
                                fontWeight: 'bold',
                                border: '1px solid #555',
                                lineHeight: '1'
                              }}>{pokemon.playerGames}</span>
                            </div>
                            <span>{getPokemonLabel(pokemon.name, pokemon.form)}</span>
                          </div>
                          <span>{pokemon.playerGames}</span>
                          <span>{pokemon.appearances}</span>
                          <span>{pokemon.pctDrafted !== null ? `${pokemon.pctDrafted}%` : '---'}</span>
                          <span>{pokemon.avgPaid !== null ? `$${pokemon.avgPaid.toLocaleString()}` : '---'}</span>
                          <span>{pokemon.avgPrice !== null ? `$${pokemon.avgPrice.toLocaleString()}` : '---'}</span>
                          <span className={pokemon.diff !== null ? (pokemon.diff < 0 ? 'diff-negative' : pokemon.diff > 0 ? 'diff-positive' : '') : ''} style={{ padding: '2px 6px' }}>
                            {pokemon.diff !== null
                              ? (pokemon.diff < 0 ? `-$${Math.abs(pokemon.diff).toLocaleString()}` : pokemon.diff > 0 ? `+$${pokemon.diff.toLocaleString()}` : '$0')
                              : '---'}
                          </span>
                        </div>
                      ))}
                    </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="match-timeline">
                {filteredMatchHistory.length === 0 && (
                  <div className="match-history-message">No match history found.</div>
                )}

                {filteredMatchHistory.map((team) => {
                  const auctions = team.pokemon_drafted || [];
                  const isRanked = team.pre_match_mmr !== null || team.placement !== null;
                  const result = getPlacementLabel(team.placement, isRanked);
                  const resultClass = getPlacementClass(team.placement, isRanked);
                  const isExpanded = expandedTeamId === team.team_id;
                  const battles = bossBattleHistory.get(team.team_id);
                  const bossVictory = getBossBattleVictory(battles);

                  return (
                    <div className="match-timeline-entry" key={team.team_id}>
                      <button
                        type="button"
                        className={`match-timeline-row ${resultClass} ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleExpandedTeam(team.team_id, team.draft_id)}
                      >
                        <div className="match-result-badge">
                          <span className="result-text">{result}</span>
                        </div>

                        <div className="match-info">
                          <div className="match-row-details">
                            <span className="draft-id">{draftDateMap.get(team.draft_id) || 'Unknown Date'}</span>
                            {bossVictory && (
                              <>
                                <span className="separator">•</span>
                                <span className="placement" style={{ color: '#90EE90' }}>{bossVictory}</span>
                                <span className="separator">•</span>
                              </>
                            )}
                            {!bossVictory && <span className="separator">•</span>}
                            <span className="team-count">{team.team_count} players</span>
                          </div>
                        </div>

                        <div className="match-pokemon-picks">
                          {auctions.length === 0 && (
                            <span className="no-picks-label">No wins</span>
                          )}
                          {auctions.map((auction: StatsAuction) => (
                            <div
                              className="match-pick"
                              key={auction.auction_id}
                              title={`#${auction.pokedex_id} - $${auction.winning_bid ?? 0}`}
                            >
                              <img
                                src={`/MiniIcons/${formatPokemonName(auction.name)}.png`}
                                alt={auction.name}
                                onError={(ev) => {
                                  (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="match-draft-details" style={{ display: 'flex', gap: '1rem' }}>
                          {/* Pokemon Section */}
                          <div style={{ flex: 1 }}>
                            <div className="match-draft-details-header">
                              <span>Pokemon</span>
                              <span>Paid</span>
                            </div>
                            {auctions.length === 0 && (
                              <div className="match-draft-details-empty">No Pokemon won in this draft.</div>
                            )}
                            {auctions.map((auction) => (
                              <div className="match-draft-details-row" key={auction.auction_id}>
                                <div className="match-draft-details-pokemon">
                                  <img
                                    src={`/MiniIcons/${formatPokemonName(auction.name)}.png`}
                                    alt={auction.name}
                                    onError={(ev) => {
                                      (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                  <span>{getPokemonLabel(auction.name, auction.form)}</span>
                                </div>
                                <span className="match-draft-details-cost">${(auction.winning_bid ?? 0).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>

                          {/* Boss Battle History Section */}
                          <div style={{ flex: 1 }}>
                            {bossBattleHistoryLoading && (
                              <div className="match-draft-details-empty">Loading boss battles...</div>
                            )}
                            {!bossBattleHistoryLoading && bossBattleHistory.has(team.team_id) && (
                              <>
                                <div className="match-draft-details-header">
                                  <span>Boss Battles</span>
                                  <span>Time</span>
                                </div>
                                {bossBattleHistory.get(team.team_id)?.length === 0 && (
                                  <div className="match-draft-details-empty">No boss battles recorded</div>
                                )}
                                {bossBattleHistory.get(team.team_id)?.map((battle, idx) => (
                                  <div className="match-draft-details-row" key={idx}>
                                    <div className="match-draft-details-pokemon">
                                      <span className={battle.is_loss ? 'loss' : 'win'}>
                                        {getTrainerNameById(battle.trainer_id, battle.version)}
                                      </span>
                                    </div>
                                    <span className="match-draft-details-cost">
                                      {battle.hours > 0 ? `${battle.hours}h ` : ''}{battle.minutes}m {battle.seconds}s
                                    </span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </article>
    </section>
  );
};

export default PlayerSearchStatsTab;
