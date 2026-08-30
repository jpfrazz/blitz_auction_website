import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../../shared/components/Header';
import { fetchStatsPageData } from '../../shared/api/stats';
import { StatsPagePlayer, StatsPageResponse, StatsPageTeamRow } from '../../types';
import PokemonStatsTab from './components/PokemonStatsTab';
import PokemonPriceHistoryChart from './PokemonPriceHistoryChart';
import PlayerSearchStatsTab from './components/PlayerSearchStatsTab';
import TierListTab from './components/TierListTab';
import RaceResultsTab from './components/RaceResultsTab';
import HallOfFameStatsTab from './components/HallOfFameStatsTab';
import './Stats.scss';

type StatsTab = 'pokemon' | 'drafts' | 'player-search' | 'hall-of-fame' | 'tier-list';

interface PlayerAggregate {
  key: string;
  name: string;
  draftsPlayed: number;
  wins: number;
  topFour: number;
  avgPlacement: number | null;
  totalSpend: number;
  avgSpendPerDraft: number;
}

const excludedPokemonNames = new Set([
  'Bombirdier',
  'Larvesta',
  'Hawlucha',
  'Falinks',
  'Absol',
  'Miltank',
  'Stonjourner',
  'Klawf',
  'Turtonator',
  "Farfetch'd-Galar",
]);

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

const getUserColor = (userId: string | null) => {
  if (!userId) return 'transparent';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsla(${h}, 45%, 50%, 0.08)`;
};

function toLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatPokemonName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("farfetch'd")) {
    return "farfetch'd";
  }
  return lower.replace(/'/g, '');
}

function parseLegacyCost(cost: string): number | null {
  const normalized = cost.trim().replace(/,/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

const Stats: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState<StatsPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatsTab>(
    searchParams.get('tab') === 'player-search' ? 'player-search' : 'pokemon',
  );
  const initialUserId = searchParams.get('userId') ?? undefined;
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);
  const [draftSortMode, setDraftSortMode] = useState<'order' | 'price' | 'user' | 'race'>('order');
  const [selectedPokemonForChart, setSelectedPokemonForChart] = useState<{ key: string; name: string } | null>(null);
  const [competitiveOnly, setCompetitiveOnly] = useState(true);
  const [draftTypeFilter, setDraftTypeFilter] = useState<'all' | 'auction' | '1v1'>('auction');
  const [gridColumns, setGridColumns] = useState<number>(0);

  useEffect(() => {
    if (!expandedDraftId) {
      setGridColumns(0);
      return;
    }

    const updateColumns = () => {
      const grid = document.querySelector('.draft-details-grid');
      if (grid) {
        const style = window.getComputedStyle(grid);
        const cols = style.getPropertyValue('grid-template-columns').split(' ').filter(s => s !== '').length;
        setGridColumns(cols);
      }
    };

    // Initial check + a small delay to ensure rendering finished
    updateColumns();
    const timer = setTimeout(updateColumns, 50);
    
    window.addEventListener('resize', updateColumns);
    return () => {
      window.removeEventListener('resize', updateColumns);
      clearTimeout(timer);
    };
  }, [expandedDraftId, draftSortMode]);

  useEffect(() => {
    const load = async () => {
      try {
        console.log('[Stats] Starting stats data fetch...');
        setLoading(true);
        const data = await fetchStatsPageData();
        console.log('[Stats] Fetched stats data successfully:', {
          playerCount: data.players.length,
          teamCount: data.teams.length,
          auctionCount: data.auctions.length,
          legacyCount: data.legacy?.length ?? 0,
        });

        // Preload mini icons so the animation doesn't start until they are ready
        const uniqueNames = new Set<string>();
        data.auctions.forEach((a) => uniqueNames.add(a.name));
        data.legacy?.forEach((l: any) => uniqueNames.add(l.pokemon));

        await Promise.all(Array.from(uniqueNames).map((name) => {
          return new Promise<void>((resolve) => {
            const img = new Image();
            img.src = `/MiniIcons/${formatPokemonName(name)}.png`;
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
        }));

        setStats(data);
      } catch (e: any) {
        console.error('[Stats] Error fetching stats data:', e);
        setError('Failed to load stats data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const playersById = useMemo(() => {
    console.log('[Stats] Building playersById map from', stats?.players?.length ?? 0, 'players');
    const map = new Map<string, StatsPagePlayer>();
    (stats?.players ?? []).forEach((player) => {
      map.set(player.user_id, player);
    });
    console.log('[Stats] playersById map created with', map.size, 'entries');
    return map;
  }, [stats?.players]);

  const draftStats = useMemo(() => {
    const statsMap = new Map<string, { total: number; minBidCount: number; teamCount: number; maxBid: number }>();

    // Count teams (players) per draft
    (stats?.teams ?? []).forEach((t) => {
      const curr = statsMap.get(t.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
      curr.teamCount += 1;
      statsMap.set(t.draft_id, curr);
    });

    (stats?.auctions ?? []).forEach((a) => {
      if (a.winning_bid !== null) {
        const curr = statsMap.get(a.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
        curr.total += 1;
        if (a.winning_bid === 100) {
          curr.minBidCount += 1;
        }
        if (a.winning_bid > curr.maxBid) {
          curr.maxBid = a.winning_bid;
        }
        statsMap.set(a.draft_id, curr);
      }
    });
    return statsMap;
  }, [stats?.auctions, stats?.teams]);

  const validDraftIds = useMemo(() => {
    const valid = new Set<string>();
    // Threshold: Exclude drafts where:
    // 1. More than 3 Pokemon sold for the minimum $100.
    // 2. The total number of Pokemon sold is not 8 * players.
    // 3. Fewer than 40 Pokemon were sold.
    // 4. No single Pokemon sold for more than $12,000.
    // This filters out test drafts or incomplete "junk" data.
    draftStats.forEach((data, id) => {
      if (data.total >= 40 && data.minBidCount <= 3 && data.total === 8 * data.teamCount && data.maxBid <= 12000) {
        valid.add(id);
      }
    });
    return valid;
  }, [draftStats]);

  const sortedAuctions = useMemo(() => {
    const sorted = [...(stats?.auctions ?? [])]
      .filter((auction) => auction.winning_bid !== null && validDraftIds.has(auction.draft_id) && !excludedPokemonNames.has(auction.name))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    console.log('[Stats] Computed sortedAuctions:', sorted.length, 'auctions with winning bids');
    return sorted;
  }, [stats?.auctions, validDraftIds]);

  const playerSummary = useMemo<PlayerAggregate[]>(() => {
    const grouped = new Map<string, {
      key: string;
      name: string;
      draftsPlayed: number;
      wins: number;
      topFour: number;
      placementSum: number;
      placementsCount: number;
      totalSpend: number;
    }>();

    const addTeamAggregate = (team: StatsPageTeamRow) => {
      const key = team.user_id || team.guest_id;
      if (!key) {
        return;
      }

      const existing = grouped.get(key) || {
        key,
        name: playersById.get(key)?.user_name || key,
        draftsPlayed: 0,
        wins: 0,
        topFour: 0,
        placementSum: 0,
        placementsCount: 0,
        totalSpend: 0,
      };

      existing.draftsPlayed += 1;

      if (team.placement !== null) {
        existing.placementSum += team.placement;
        existing.placementsCount += 1;
        if (team.placement === 1) {
          existing.wins += 1;
        }
        if (team.placement <= 4) {
          existing.topFour += 1;
        }
      }

      grouped.set(key, existing);
    };

    (stats?.teams ?? [])
      .filter((team) => validDraftIds.has(team.draft_id))
      .forEach(addTeamAggregate);

    sortedAuctions.forEach((auction) => {
      const key = auction.winning_user_id || auction.winning_guest_id;
      if (!key) {
        return;
      }
      const existing = grouped.get(key);
      if (existing) {
        existing.totalSpend += auction.winning_bid ?? 0;
      }
    });

    const result = Array.from(grouped.values())
      .map((entry) => ({
        key: entry.key,
        name: entry.name,
        draftsPlayed: entry.draftsPlayed,
        wins: entry.wins,
        topFour: entry.topFour,
        avgPlacement: entry.placementsCount > 0
          ? Number((entry.placementSum / entry.placementsCount).toFixed(2))
          : null,
        totalSpend: entry.totalSpend,
        avgSpendPerDraft: entry.draftsPlayed > 0
          ? Math.round(entry.totalSpend / entry.draftsPlayed)
          : 0,
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        if (a.avgPlacement === null && b.avgPlacement !== null) {
          return 1;
        }
        if (a.avgPlacement !== null && b.avgPlacement === null) {
          return -1;
        }
        if (a.avgPlacement !== null && b.avgPlacement !== null && a.avgPlacement !== b.avgPlacement) {
          return a.avgPlacement - b.avgPlacement;
        }
        return b.totalSpend - a.totalSpend;
      });
    console.log('[Stats] Computed playerSummary:', result.length, 'players:', {
      totalWins: result.reduce((sum, p) => sum + p.wins, 0),
      totalDraftsPlayed: result.reduce((sum, p) => sum + p.draftsPlayed, 0),
    });
    return result;
  }, [playersById, sortedAuctions, stats?.teams, validDraftIds]);

  const draftSummary = useMemo(() => {
    const drafts = new Map<string, {
      draftId: string;
      draftName: string | null;
      hostId: string | null;
      ranked: boolean;
      teamCount: number;
      auctionCount: number;
      highestBid: number;
      date: string | null;
      participants: string[];
      winner: string | null;
      runnerUp: string | null;
    }>();

    (stats?.teams ?? []).forEach((team) => {
      const dStat = draftStats.get(team.draft_id);
      const is1v1 = team.draft_type === '1v1';
      if (!is1v1) {
        if (!dStat) return;
        if (dStat.total < 1) return;
        if (dStat.total < 16) return;
      }
      const existing = drafts.get(team.draft_id) || {
        draftId: team.draft_id,
        draftName: team.draft_name || null,
        hostId: team.host || null,
        ranked: !!team.ranked,
        draftType: team.draft_type || 'auction',
        teamCount: 0,
        auctionCount: 0,
        highestBid: 0,
        date: null,
        participants: [] as string[],
        winner: null,
        runnerUp: null,
      };
      existing.teamCount += 1;

      const pId = team.user_id || team.guest_id || '';
      const pInfo = playersById.get(pId);
      const isGuest = !team.user_id || pInfo?.is_guest;
      const pDisplayName = isGuest ? 'Guest User' : (pInfo?.user_name || team.user_id || 'Guest User'); // Still gather for CSV
      console.log(`[DraftSummary] Processing team for draft ${team.draft_id}: draftName from team is ${existing.draftName}`);

      const racePlacement = team.race_placement ?? team.placement;
      if (racePlacement === 1) {
        existing.winner = pDisplayName;
      } else if (racePlacement === 2) {
        existing.runnerUp = pDisplayName;
      }

      // Only push if not already present to avoid duplicates in CSV
      if (!existing.participants.includes(pDisplayName)) {
        existing.participants.push(pDisplayName);
      }
      drafts.set(team.draft_id, existing);
    });

    (stats?.auctions ?? []).forEach((auction: any) => {
      const is1v1 = auction.draft_type === '1v1';
      if (!is1v1 && auction.winning_bid === null) return;
      const dStat = draftStats.get(auction.draft_id);
      if (!is1v1) {
        if (!dStat || dStat.total < 1) return;
        if (dStat.total < 16) return;
      }

      const existing = drafts.get(auction.draft_id) || {
        draftId: auction.draft_id,
        draftName: auction.draft_name || null,
        hostId: auction.host || null,
        ranked: !!auction.ranked,
        draftType: auction.draft_type || 'auction',
        teamCount: 0,
        auctionCount: 0,
        highestBid: 0,
        date: null,
        participants: [] as string[],
        winner: null,
        runnerUp: null,
      };

      const winningBid = auction.winning_bid ?? 0;

      if (!existing.draftName && auction.draft_name) {
        existing.draftName = auction.draft_name;
      }

      if (!existing.hostId && auction.host) {
        existing.hostId = auction.host;
      }

      existing.auctionCount += 1;
      if (winningBid > existing.highestBid) {
        existing.highestBid = winningBid;
      }
      if (!existing.date && auction.created_at) {
        existing.date = auction.created_at;
      }
      console.log(`[DraftSummary] Processing auction for draft ${auction.draft_id}: draftName from auction is ${existing.draftName}`);

      drafts.set(auction.draft_id, existing);
    });

    const result = Array.from(drafts.values())
      .map((draft: any) => {
        const dStat = draftStats.get(draft.draftId);
        const errors = [];
        if (draft.draftType === '1v1') {
          if (draft.auctionCount < 30) errors.push("Incomplete 1v1 draft");
        } else if (dStat) {
          if (dStat.total < 40) errors.push("Fewer than 40 Pokemon sold");
          if (dStat.minBidCount > 3) errors.push("More than 3 Pokemon sold for $100");
          if (dStat.total !== 8 * dStat.teamCount) errors.push(`Total Pokemon sold (${dStat.total}) is not 8 * players (${dStat.teamCount})`);
          if (dStat.maxBid > 12000) errors.push("A Pokemon sold for over $12,000");
        }
        return {
          ...draft,
          participants: (draft.participants as string[]).sort((a, b) => a.localeCompare(b)),
          formattedDate: draft.date ? new Date(draft.date).toLocaleDateString() : '-',
          validationError: errors.join('. '),
        };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    console.log('[Stats] draftSummary computed:', {
      draftCount: result.length,
      totalAuctions: result.reduce((sum, d) => sum + d.auctionCount, 0),
      totalTeams: result.reduce((sum, d) => sum + d.teamCount, 0),
      results: result,
    });

    return result;
  }, [stats?.auctions, stats?.teams, draftStats, playersById]);

  const kpis = useMemo(() => {
    // Adding 152 to account for legacy drafts
    const uniqueDrafts = new Set((stats?.teams ?? []).filter((t) => validDraftIds.has(t.draft_id)).map((team) => team.draft_id)).size + 152;
    const uniquePlayers = playerSummary.length;

    const allSales = [
      ...sortedAuctions
        .map((auction) => auction.winning_bid)
        .filter((bid): bid is number => bid !== null),
      ...(stats?.legacy ?? [])
        .map((legacyRow) => parseLegacyCost(legacyRow.cost))
        .filter((bid): bid is number => bid !== null),
    ];

    const totalMoneySpent = allSales.reduce((sum, bid) => sum + bid, 0);

    const result = {
      uniqueDrafts,
      uniquePlayers,
      totalWinningAuctions: allSales.length,
      totalMoneySpent,
    };

    console.log('[Stats] KPIs computed:', {
      uniqueDrafts,
      uniquePlayers,
      totalWinningAuctions: allSales.length,
      totalMoneySpent,
    });

    return result;
  }, [playerSummary.length, sortedAuctions, stats?.legacy, stats?.teams, validDraftIds]);

  const handleDownloadCSV = (draft: any) => {
    const is1v1 = draft.draftType === '1v1';
    const auctions = (stats?.auctions ?? [])
      .filter((a) => a.draft_id === draft.draftId && (is1v1 || a.winning_bid !== null))
      .sort((a, b) => a.draft_order - b.draft_order);

    let csvContent = `Draft ID: ${draft.draftId}\n`;
    csvContent += `Date: ${draft.formattedDate}\n`;
    csvContent += `Draft Type: ${is1v1 ? '1v1' : 'Auction'}\n`;
    csvContent += `${is1v1 ? 'Total Actions' : 'Total Pokemon Sold'}: ${draft.auctionCount}\n\n`;
    csvContent += is1v1 ? `Order,Pokemon,Drafted By,Action\n` : `Order,Pokemon,Drafted By,Cost\n`;

    auctions.forEach((a, index) => {
      const winnerKey = a.winning_user_id || a.winning_guest_id || '';
      const winnerName = playersById.get(winnerKey)?.user_name || winnerKey || '-';
      const safeWinnerName = winnerName.includes(',') ? `"${winnerName.replace(/"/g, '""')}"` : winnerName;
      if (is1v1) {
        csvContent += `${index + 1},${a.name},${safeWinnerName},${a.action || ''}\n`;
      } else {
        csvContent += `${index + 1},${a.name},${safeWinnerName},${a.winning_bid}\n`;
      }
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `draft-results-${draft.draftId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="match-history-page">
        <Header />
        <main className="match-history-main">Loading stats...</main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="match-history-page">
        <Header />
        <main className="match-history-main">
          <div className="match-history-error">{error}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="match-history-page">
      <Header />
      <main className="match-history-main">
        <section className="stats-hero-card">
          <div>
            <h1>Draft Stats</h1>
            <p>Auction analytics across competitive drafts</p>
          </div>
          <div className="stats-hero-meta">Live from completed draft data</div>
        </section>

        <section className="stats-kpi-grid">
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '0ms' }}>
            <div className="kpi-label">Completed Drafts</div>
            <div className="kpi-value">{kpis.uniqueDrafts}</div>
          </article>
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '50ms' }}>
            <div className="kpi-label">Tracked Players</div>
            <div className="kpi-value">{kpis.uniquePlayers}</div>
          </article>
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '100ms' }}>
            <div className="kpi-label">Total Sales</div>
            <div className="kpi-value">{kpis.totalWinningAuctions}</div>
          </article>
          <article className="kpi-card stats-row-animate" style={{ animationDelay: '150ms' }}>
            <div className="kpi-label">Total Money Spent</div>
            <div className="kpi-value">${kpis.totalMoneySpent.toLocaleString()}</div>
          </article>
        </section>

        <section className="stats-tab-bar" aria-label="Stats tabs">
          <button
            className={`tab-chip ${activeTab === 'pokemon' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('pokemon')}
          >
            Pokemon
          </button>
          <button
            className={`tab-chip ${activeTab === 'drafts' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('drafts')}
          >
            Drafts
          </button>
          <button
            className={`tab-chip ${activeTab === 'player-search' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('player-search')}
          >
            Player Search
          </button>
          <button
            className={`tab-chip ${activeTab === 'hall-of-fame' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('hall-of-fame')}
          >
            Hall of Fame
          </button>
          <button
            className={`tab-chip ${activeTab === 'tier-list' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveTab('tier-list')}
          >
            Tier List
          </button>
        </section>

        {activeTab === 'pokemon' && (
          <PokemonStatsTab
            stats={stats}
            loading={loading}
            error={error}
          />
        )}

        {activeTab === 'drafts' && (
          <section className="stats-content-grid">
            <article className="stats-panel">
              <div className="stats-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>Draft Breakdown</h2>
                <div className="competitive-toggle-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span 
                      style={{ cursor: 'pointer', fontWeight: 500 }} 
                      onClick={() => setCompetitiveOnly(!competitiveOnly)}
                    >
                      Competitive Drafts only
                    </span>
                    <div
                      onClick={() => setCompetitiveOnly(!competitiveOnly)}
                      style={{ 
                        position: 'relative', 
                        width: '40px', 
                        height: '20px', 
                        backgroundColor: competitiveOnly ? '#4caf50' : '#333', 
                        borderRadius: '20px', 
                        cursor: 'pointer', 
                        transition: 'background-color 0.3s ease' 
                      }}
                    >
                      <div style={{ 
                        position: 'absolute', 
                        top: '2px', 
                        left: competitiveOnly ? '22px' : '2px', 
                        width: '16px', 
                        height: '16px', 
                        backgroundColor: 'white', 
                        borderRadius: '50%', 
                        transition: 'left 0.3s ease' 
                      }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="table-wrap">
                <table className="draft-summary-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Winner</th>
                      <th>Runner Up</th>
                      <th>Host</th>
                      <th>Players</th>
                      <th>Pokemon Sold</th>
                      <th style={{ width: '60px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftSummary
                      .filter((draft) => {
                        if (draftTypeFilter !== 'all' && draft.draftType !== draftTypeFilter) return false;
                        return !competitiveOnly || validDraftIds.has(draft.draftId) || draft.draftType === '1v1';
                      })
                      .map((draft, index) => (
                      <React.Fragment key={draft.draftId}>
                        <tr
                          className={`draft-row-clickable stats-row-animate ${validDraftIds.has(draft.draftId) ? 'competitive-draft' : 'non-competitive-draft'}`}
                          title={!validDraftIds.has(draft.draftId) ? `Excluded from stats: ${draft.validationError}` : undefined}
                          style={{ animationDelay: `${200 + index * 30}ms`, backgroundColor: validDraftIds.has(draft.draftId) ? 'rgba(76, 175, 80, 0.1)' : undefined }}
                          onClick={() => {
                            const isOpening = expandedDraftId !== draft.draftId;
                            setExpandedDraftId(isOpening ? draft.draftId : null);
                            if (isOpening) {
                              setDraftSortMode('race');
                              setSelectedPokemonForChart(null);
                            }
                          }}
                        >
                          <td>{draft.formattedDate}</td>
                          <td>{draft.winner || '-'}</td>
                          <td>{draft.runnerUp || '-'}</td>
                          <td>{playersById.get(draft.hostId || '')?.user_name || '-'}</td>
                          <td>{draft.teamCount}</td>
                          <td>{draft.auctionCount}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="tab-chip"
                              style={{ padding: '2px 8px', fontSize: '0.7rem', minWidth: 'auto', margin: 0 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadCSV(draft);
                              }}
                              title="Download Results as CSV"
                            >
                              CSV
                            </button>
                          </td>
                        </tr>
                        {expandedDraftId === draft.draftId && (
                          <tr className="draft-details-row">
                            <td colSpan={7}>
                              <div className="draft-details-controls" style={{ display: 'flex', gap: '8px', marginBottom: '12px', padding: '10px 10px 0' }}>
                                <button
                                  className={`tab-chip ${draftSortMode === 'race' ? 'active' : ''}`}
                                  type="button"
                                  style={{ padding: '2px 8px', fontSize: '0.95rem', minWidth: 'auto', margin: 0 }}
                                  onClick={() => setDraftSortMode('race')}
                                >
                                  Race Results
                                </button>
                                <button
                                  className={`tab-chip ${draftSortMode !== 'race' ? 'active' : ''}`}
                                  type="button"
                                  style={{ padding: '2px 8px', fontSize: '0.95rem', minWidth: 'auto', margin: 0 }}
                                  onClick={() => setDraftSortMode('order')}
                                >
                                  Pokemon Sold
                                </button>
                              </div>
                              {draftSortMode !== 'race' && (
                                <div className="draft-details-controls" style={{ display: 'flex', gap: '8px', marginBottom: '12px', padding: '0 10px' }}>
                                  <button
                                    className={`tab-chip ${draftSortMode === 'order' ? 'active' : ''}`}
                                    type="button"
                                    style={{ padding: '2px 8px', fontSize: '0.85rem', minWidth: 'auto', margin: 0 }}
                                    onClick={() => setDraftSortMode('order')}
                                  >
                                    Sort by Sale Order
                                  </button>
                                  {draft.draftType !== '1v1' && (
                                    <button
                                      className={`tab-chip ${draftSortMode === 'price' ? 'active' : ''}`}
                                      type="button"
                                      style={{ padding: '2px 8px', fontSize: '0.85rem', minWidth: 'auto', margin: 0 }}
                                      onClick={() => setDraftSortMode('price')}
                                    >
                                      Sort by Price
                                    </button>
                                  )}
                                  <button
                                    className={`tab-chip ${draftSortMode === 'user' ? 'active' : ''}`}
                                    type="button"
                                    style={{ padding: '2px 8px', fontSize: '0.85rem', minWidth: 'auto', margin: 0 }}
                                    onClick={() => setDraftSortMode('user')}
                                  >
                                    Sort by Player
                                  </button>
                                </div>
                              )}
                              {(() => {
                                if (draftSortMode === 'race') {
                                  return <RaceResultsTab draftId={draft.draftId} />;
                                }

                                const renderCard = (auction: any) => {
                                  const is1v1 = auction.draft_type === '1v1';
                                  const winnerKey = auction.winning_user_id || auction.winning_guest_id || '';
                                  const winnerName = playersById.get(winnerKey)?.user_name || winnerKey || '-';
                                  const identity = resolveIdentity(auction.name, auction.form || '');
                                  const displayName = `${identity.name}${identity.form && identity.form !== 'base' ? ` (${toLabel(identity.form)})` : ''}`;
                                  const isSelected = selectedPokemonForChart?.key === identity.key;
                                  const actionLabel = is1v1 ? (auction.action || 'PICK') : undefined;

                                  return (
                                    <div
                                      key={auction.auction_id}
                                      className={`draft-detail-card ${isSelected ? 'selected' : ''}`}
                                      title={
                                        is1v1
                                          ? `${displayName} - ${actionLabel}${winnerName && winnerName !== '-' ? ` · ${winnerName}` : ''}`
                                          : `${displayName} - $${(auction.winning_bid ?? 0).toLocaleString()} (Click to view price history)`
                                      }
                                      style={{
                                        cursor: is1v1 ? 'default' : 'pointer',
                                        border: isSelected ? '2px solid #4caf50' : undefined,
                                        backgroundColor: getUserColor(winnerKey),
                                        opacity: is1v1 && auction.action === 'BAN' ? 0.6 : 1,
                                      }}
                                      onClick={() => {
                                        if (is1v1) return;
                                        if (isSelected) {
                                          setSelectedPokemonForChart(null);
                                        } else {
                                          setSelectedPokemonForChart({ key: identity.key, name: displayName });
                                        }
                                      }}
                                    >
                                      <img
                                        src={`/baseforms/${auction.name}.png`}
                                        alt={auction.name}
                                        onError={(ev) => {
                                          (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                      <div className="pokemon-name">{auction.name}</div>
                                      {is1v1 ? (
                                        <>
                                          <div className="pokemon-price" style={{ fontSize: '0.75rem' }}>{actionLabel}</div>
                                          {winnerName !== '-' && <div className="pokemon-winner">{winnerName}</div>}
                                        </>
                                      ) : (
                                        <>
                                          <div className="pokemon-price">${(auction.winning_bid ?? 0).toLocaleString()}</div>
                                          <div className="pokemon-winner">{winnerName}</div>
                                        </>
                                      )}
                                    </div>
                                  );
                                };

                                const renderPriceChart = () => {
                                  if (!selectedPokemonForChart) return null;
                                  return (
                                    <div className="price-history-container" style={{ gridColumn: '1 / -1', width: '100%', padding: '15px 10px' }}>
                                      <PokemonPriceHistoryChart
                                        pokemonKey={selectedPokemonForChart.key}
                                        pokemonName={selectedPokemonForChart.name}
                                        stats={stats!}
                                      />
                                    </div>
                                  );
                                };

                                const draftAuctions = (stats?.auctions ?? [])
                                  .filter((a) => a.draft_id === draft.draftId && (a.draft_type === '1v1' || a.winning_bid !== null));

                                const renderListWithChart = (auctions: any[]) => {
                                  const selectedAuctionIndex = auctions.findIndex(a => resolveIdentity(a.name, a.form || '').key === selectedPokemonForChart?.key);
                                  
                                  let chartAfterIndex = -1;
                                  if (selectedAuctionIndex !== -1 && gridColumns > 0) {
                                    chartAfterIndex = Math.min(
                                      auctions.length - 1,
                                      (Math.floor(selectedAuctionIndex / gridColumns) + 1) * gridColumns - 1
                                    );
                                  }

                                  return (
                                    <div className="draft-details-grid">
                                      {auctions.map((auction, idx) => (
                                        <React.Fragment key={auction.auction_id}>
                                          {renderCard(auction)}
                                          {idx === chartAfterIndex && renderPriceChart()}
                                        </React.Fragment>
                                      ))}
                                      {selectedAuctionIndex !== -1 && chartAfterIndex === -1 && renderPriceChart()}
                                    </div>
                                  );
                                };

                                if (draftSortMode === 'user') {
                                  const userIds = Array.from(new Set(draftAuctions.map(a => a.winning_user_id || a.winning_guest_id || '')))
                                    .sort((a, b) => {
                                      const nameA = playersById.get(a)?.user_name || a;
                                      const nameB = playersById.get(b)?.user_name || b;
                                      return nameA.localeCompare(nameB);
                                    });

                                  return (
                                    <div className="draft-user-groups">
                                      {userIds.map(uid => {
                                        const userAuctions = draftAuctions
                                          .filter(a => (a.winning_user_id || a.winning_guest_id || '') === uid)
                                          .sort((a, b) => {
                                            if (a.draft_type === '1v1') return a.draft_order - b.draft_order;
                                            return (b.winning_bid ?? 0) - (a.winning_bid ?? 0);
                                          });
                                        return (
                                          <div key={uid} className="user-draft-group" style={{ marginBottom: '0.75rem' }}>
                                            {renderListWithChart(userAuctions)}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                }

                                const finalAuctions = draftAuctions
                                  .sort((a, b) => {
                                    if (draftSortMode === 'price' && a.draft_type !== '1v1') {
                                      return (b.winning_bid ?? 0) - (a.winning_bid ?? 0);
                                    }
                                    return a.draft_order - b.draft_order;
                                  });

                                return renderListWithChart(finalAuctions);
                              })()}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    {draftSummary.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-cell">No draft stats available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === 'player-search' && (
          <PlayerSearchStatsTab
            stats={stats}
            loading={loading}
            error={error}
            validDraftIds={validDraftIds}
            initialUserId={initialUserId}
          />
        )}

        {activeTab === 'hall-of-fame' && (
          <HallOfFameStatsTab validDraftIds={validDraftIds} />
        )}

        {activeTab === 'tier-list' && (
          <TierListTab 
            stats={stats} 
            playersById={playersById}
          />
        )}
      </main>
    </div>
  );
};

export default Stats;