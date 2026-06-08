import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as htmlToImage from 'html-to-image';
import { FaCog, FaArrowUp, FaArrowDown, FaCopy, FaTrash } from 'react-icons/fa';
import { StatsPageResponse, StatsPagePlayer } from '../../../types';
import './TierListTab.scss';

interface TierRow {
    id: string;
    name: string;
    color: string;
    pokemon: string[];
}

interface TierListData {
    id: string;
    name: string;
    tiers: TierRow[];
}

interface TierListTabProps {
    stats: StatsPageResponse | null;
    playersById: Map<string, StatsPagePlayer>;
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

const TIER_COLORS = [
    '#ff7f7f', // Red (S)
    '#ff9f7f', // Red-Orange (A+)
    '#ffbf7f', // Dark Orange (A)
    '#ffdf7f', // Yellow-Orange (A-)
    '#ffff7f', // Yellow (B+)
    '#bfff7f', // Lime (B)
    '#7fff7f', // Green (B-)
    '#7fffbf', // Teal (C+)
    '#7fffff', // Cyan (C)
    '#7fbfff', // Light Blue (C-)
    '#7f9fff', // Periwinkle (New)
    '#7f7fff', // Blue (D+)
    '#bf7fff', // Purple (D)
    '#df7fff', // Pinkish-Purple (D-)
];

const DEFAULT_TIERS_CONFIG = [
    { id: 'tier-4250', name: 'S+\n$4250+', color: '#ff7f7f' },
    { id: 'tier-4000', name: 'S\n$4000+', color: '#ff9f7f' },
    { id: 'tier-3750', name: 'A+\n$3750+', color: '#ffbf7f' },
    { id: 'tier-3500', name: 'A\n$3500+', color: '#ffdf7f' },
    { id: 'tier-3250', name: 'A-\n$3250+', color: '#ffff7f' },
    { id: 'tier-3000', name: 'B+\n$3000+', color: '#bfff7f' },
    { id: 'tier-2750', name: 'B\n$2750+', color: '#7fff7f' },
    { id: 'tier-2500', name: 'B-\n$2500+', color: '#7fffbf' },
    { id: 'tier-2250', name: 'C+\n$2250+', color: '#7fffff' },
    { id: 'tier-2000', name: 'C\n$2000+', color: '#7fbfff' },
    { id: 'tier-1750', name: 'C-\n$1750+', color: '#7f9fff' },
    { id: 'tier-1500', name: 'D+\n$1500+', color: '#7f7fff' },
    { id: 'tier-1250', name: 'D\n$1250+', color: '#bf7fff' },
    { id: 'tier-1000', name: 'D-\n$1000+', color: '#df7fff' },
];

function formatPokemonName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.startsWith("farfetch'd")) return "farfetch'd";
    return lower.replace(/'/g, '');
}

// Helper function (duplicated from PokemonStatsTab for consistency)
function calculateQuantile(sortedData: number[], q: number) {
  const pos = (sortedData.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedData[base + 1] !== undefined) {
    return sortedData[base] + rest * (sortedData[base + 1] - sortedData[base]);
  }
  return sortedData[base];
}

const TierListTab: React.FC<TierListTabProps> = ({ stats }) => {
    const [lists, setLists] = useState<TierListData[]>([]);
    const [squareSize, setSquareSize] = useState(60);
    const [showComparison, setShowComparison] = useState(false);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [draggedPokemon, setDraggedPokemon] = useState<{ name: string; sourceId: string; index: number } | null>(null);
    const [pool, setPool] = useState<string[]>([]);
    const [poolSearch, setPoolSearch] = useState('');
    
    const tierListRef = useRef<HTMLDivElement>(null);
    const labelRefs = useRef<Record<string, HTMLSpanElement | null>>({});

    const isDefaultList = activeListId === 'default-stats-list';

    // Replicate competitive draft filtering logic from PokemonStatsTab
    const validDraftIds = useMemo(() => {
        const statsMap = new Map<string, { total: number; minBidCount: number; teamCount: number; maxBid: number }>();
        (stats?.teams ?? []).forEach((t) => {
            const curr = statsMap.get(t.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
            curr.teamCount += 1;
            statsMap.set(t.draft_id, curr);
        });
        (stats?.auctions ?? []).forEach((a) => {
            if (a.winning_bid !== null) {
                const curr = statsMap.get(a.draft_id) || { total: 0, minBidCount: 0, teamCount: 0, maxBid: 0 };
                curr.total += 1;
                if (a.winning_bid === 100) curr.minBidCount += 1;
                if (a.winning_bid > curr.maxBid) curr.maxBid = a.winning_bid;
                statsMap.set(a.draft_id, curr);
            }
        });

        const valid = new Set<string>();
        statsMap.forEach((data, id) => {
            if (data.total >= 40 && data.minBidCount <= 3 && data.total === 8 * data.teamCount && data.maxBid <= 12000) {
                valid.add(id);
            }
        });
        return valid;
    }, [stats?.auctions, stats?.teams]);

    // Aggregates all bids for each Pokemon and calculates a cleaned average price
    const pokemonAggregates = useMemo(() => {
        if (!stats) return [];
        const pokemonBidsMap = new Map<string, { name: string; bids: number[] }>();
        
        // Process auctions
        stats.auctions.forEach(a => {
            if (a.winning_bid === null || !validDraftIds.has(a.draft_id) || excludedPokemonNames.has(a.name)) return;
            
            const { name, key } = resolveIdentity(a.name, a.form || '');
            const entry = pokemonBidsMap.get(key) || { name, bids: [] };
            entry.bids.push(a.winning_bid);
            pokemonBidsMap.set(key, entry);
        });

        // Process legacy data
        stats.legacy?.forEach(l => {
            if (excludedPokemonNames.has(l.pokemon)) return;
            const cost = parseInt(l.cost.toString().replace(/[^0-9]/g, ''), 10);
            if (isNaN(cost)) return;

            const { name, key } = resolveIdentity(l.pokemon, '');
            const entry = pokemonBidsMap.get(key) || { name, bids: [] };
            entry.bids.push(cost);
            pokemonBidsMap.set(key, entry);
        });

        return Array.from(pokemonBidsMap.values())
            .map(entry => {
                let bids = entry.bids.filter(b => b !== 100); // Exclude $100 bids

                if (bids.length > 1) {
                    const sortedBids = [...bids].sort((a, b) => a - b);
                    const q1 = calculateQuantile(sortedBids, 0.25);
                    const q3 = calculateQuantile(sortedBids, 0.75);
                    const iqr = q3 - q1;
                    const lower = q1 - 1.5 * iqr;
                    const upper = q3 + 2.0 * iqr;
                    bids = sortedBids.filter(b => b >= lower && b <= upper);
                }

                const count = bids.length;
                const sum = bids.reduce((a, b) => a + b, 0);
                const avg = count > 0 ? Math.round(sum / count) : 0;

                return {
                    name: entry.name,
                    avg: avg,
                };
            })
            .filter(p => p.avg > 100) // Match Stats Tab minimum threshold
            .sort((a, b) => b.avg - a.avg); // Sort by price DESC to match Stats Tab order
    }, [stats, validDraftIds]);

    // This replaces the old `allPokemon` memo and provides cleaned average prices
    const allPokemonWithCleanedAvg = pokemonAggregates;

    const generateDefaultTiers = useMemo(() => {
        const defaultTiers = DEFAULT_TIERS_CONFIG.map(config => ({
            ...config,
            pokemon: [] as string[]
        }));

        allPokemonWithCleanedAvg.forEach(p => {
            if (p.avg >= 4250) defaultTiers[0].pokemon.push(p.name);
            else if (p.avg >= 4000) defaultTiers[1].pokemon.push(p.name);
            else if (p.avg >= 3750) defaultTiers[2].pokemon.push(p.name);
            else if (p.avg >= 3500) defaultTiers[3].pokemon.push(p.name);
            else if (p.avg >= 3250) defaultTiers[4].pokemon.push(p.name);
            else if (p.avg >= 3000) defaultTiers[5].pokemon.push(p.name);
            else if (p.avg >= 2750) defaultTiers[6].pokemon.push(p.name);
            else if (p.avg >= 2500) defaultTiers[7].pokemon.push(p.name);
            else if (p.avg >= 2250) defaultTiers[8].pokemon.push(p.name);
            else if (p.avg >= 2000) defaultTiers[9].pokemon.push(p.name);
            else if (p.avg >= 1750) defaultTiers[10].pokemon.push(p.name);
            else if (p.avg >= 1500) defaultTiers[11].pokemon.push(p.name);
            else if (p.avg >= 1250) defaultTiers[12].pokemon.push(p.name);
            else if (p.avg >= 1000) defaultTiers[13].pokemon.push(p.name);
            // Pokemon with avg < 1000 remain in the pool
        });
        return defaultTiers;
    }, [allPokemonWithCleanedAvg]);

    // 1. Initial Load from LocalStorage or Generate Default
    useEffect(() => {
        const saved = localStorage.getItem('blitz_tier_lists');
        let initialLists: TierListData[] = [];
        let initialActiveListId: string | null = null;

        if (saved) { // Load from local storage
            initialLists = JSON.parse(saved);
            if (initialLists.length > 0) initialActiveListId = initialLists[0].id;
        }

        // If no lists were loaded or the default list doesn't exist, create it
        if (initialLists.length === 0 || !initialLists.some(l => l.id === 'default-stats-list')) {
            if (generateDefaultTiers.some(t => t.pokemon.length > 0)) {
                const newDefaultList: TierListData = {
                    id: 'default-stats-list',
                    name: 'Stats Based Tier List',
                    tiers: generateDefaultTiers
                };
                initialLists.unshift(newDefaultList); // Add to the beginning
                if (!initialActiveListId) initialActiveListId = newDefaultList.id;
            }
        }

        setLists(initialLists);
        setActiveListId(initialActiveListId);
    }, []); // Empty dependency array: runs once on mount

    // 2. Update the default list whenever stats or default tiers change
    useEffect(() => {
        // Only update if the default list exists or needs to be created
        if (generateDefaultTiers.some(t => t.pokemon.length > 0)) {
            const newDefaultList: TierListData = {
                id: 'default-stats-list',
                name: 'Stats Based Tier List',
                tiers: generateDefaultTiers
            };

            setLists(prevLists => {
                const defaultListIndex = prevLists.findIndex(l => l.id === 'default-stats-list');
                if (defaultListIndex !== -1) {
                    // Replace existing default list with the newly generated one
                    return prevLists.map((l, idx) => idx === defaultListIndex ? newDefaultList : l);
                } else {
                    // Add new default list if it doesn't exist
                    return [newDefaultList, ...prevLists];
                }
            });

            // If no active list is set, or the active list is the default one, set it to the default
            setActiveListId(prevActiveId => {
                if (!prevActiveId || prevActiveId === 'default-stats-list') {
                    return 'default-stats-list';
                }
                return prevActiveId;
            });
        }
    }, [stats, generateDefaultTiers]); // Depends on stats and generateDefaultTiers

    // 3. Save lists to LocalStorage whenever they change
    useEffect(() => {
        if (lists.length > 0) {
            // Enforce color order based on current indices whenever lists change
            const coloredLists = lists.map(list => ({
                ...list,
                tiers: list.tiers.map((t, idx) => ({
                    ...t,
                    color: TIER_COLORS[idx % TIER_COLORS.length]
                }))
            }));
            localStorage.setItem('blitz_tier_lists', JSON.stringify(coloredLists));
        } else {
            localStorage.removeItem('blitz_tier_lists');
        }
    }, [lists]);

    const activeList = lists.find(l => l.id === activeListId);

    // Maintain a local pool state if needed, but here we derive it
    const tieredNames = useMemo(() => {
        if (!activeList) return new Set<string>();
        return new Set(activeList.tiers.flatMap(t => t.pokemon));
    }, [activeList]);

    useEffect(() => {
        setPool(prev => {
            const allAvailable = new Set(allPokemonWithCleanedAvg.map(p => p.name));
            
            // 1. Remove anything that is now tiered or no longer in the master stats list
            let next = prev.filter(name => !tieredNames.has(name) && allAvailable.has(name));
            
            // 2. Add anything new from stats that isn't tiered and isn't already in our pool
            const inPool = new Set(next);
            const toAdd = allPokemonWithCleanedAvg
                .filter(p => !tieredNames.has(p.name) && !inPool.has(p.name))
                .map(p => p.name);
            
            return [...next, ...toAdd];
        });
    }, [allPokemonWithCleanedAvg, tieredNames]);

    const filteredPool = useMemo(() => {
        const lowerCaseSearch = poolSearch.toLowerCase();
        return pool.filter(name => name.toLowerCase().includes(lowerCaseSearch));
    }, [pool, poolSearch]);

    // Ranks for comparison logic
    const defaultRanks = useMemo(() => {
        const flat = generateDefaultTiers.flatMap(t => t.pokemon);
        const m = new Map<string, number>();
        flat.forEach((p, i) => m.set(p, i));
        return m;
    }, [generateDefaultTiers]);

    const currentRanks = useMemo(() => {
        const flat = activeList?.tiers.flatMap(t => t.pokemon) || [];
        const m = new Map<string, number>();
        flat.forEach((p, i) => m.set(p, i));
        return m;
    }, [activeList]);

    const handleAddList = () => {
        if (lists.length >= 6) return;
        const defaultRowNames = ['S', 'A', 'B', 'C', 'D'];
        const newList: TierListData = {
            id: Date.now().toString(),
            name: `New Tier List ${lists.length + 1}`,
            tiers: defaultRowNames.map((name, idx) => ({
                id: `tier-${Date.now()}-${idx}`,
                name,
                color: TIER_COLORS[idx % TIER_COLORS.length],
                pokemon: []
            }))
        };
        setLists([...lists, newList]);
        setActiveListId(newList.id);
    };

    const handleDuplicateList = () => {
        if (lists.length >= 6 || !activeList) return;
        const newList: TierListData = { // Deep copy of the active list
            id: Date.now().toString(),
            name: `${activeList.name} (Copy)`,
            tiers: activeList.tiers.map((tier, idx) => ({
                ...tier,
                id: `tier-${Date.now()}-${idx}`, // New unique IDs for tiers
                color: TIER_COLORS[idx % TIER_COLORS.length],
                pokemon: [...tier.pokemon]
            }))
        };
        setLists([...lists, newList]);
        setActiveListId(newList.id);
    };

    const handleReset = () => {
        if (!activeList) return;
        const updated = lists.map(l => l.id === activeListId ? {
            ...l,
            tiers: isDefaultList 
                ? generateDefaultTiers 
                : l.tiers.map(t => ({ ...t, pokemon: [] }))
        } : l);
        setLists(updated);
    };

    const handleDeleteList = (id: string) => {
        if (id === 'default-stats-list') return;
        const remaining = lists.filter(l => l.id !== id);
        setLists(remaining);
        if (activeListId === id && remaining.length > 0) {
            setActiveListId(remaining[0].id);
        }
    };

    const updateTierName = (tierId: string, newName: string) => {
        setLists(lists.map(l => l.id === activeListId ? {
            ...l,
            tiers: l.tiers.map(t => t.id === tierId ? { ...t, name: newName } : t)
        } : l));
    };

    const modifyRows = (tierId: string, action: 'above' | 'below' | 'delete') => {
        setLists(lists.map(l => {
            if (l.id !== activeListId) return l;
            const idx = l.tiers.findIndex(t => t.id === tierId);
            let newTiers = [...l.tiers];
            
            if (action === 'delete') {
                newTiers.splice(idx, 1);
            } else {
                const newRow = { 
                    id: `tier-${Date.now()}`, 
                    name: 'NEW', 
                    color: '#555', 
                    pokemon: [] 
                };
                newTiers.splice(action === 'above' ? idx : idx + 1, 0, newRow);
            }

            // Enforce color order after modification
            newTiers = newTiers.map((t, i) => ({
                ...t,
                color: TIER_COLORS[i % TIER_COLORS.length]
            }));

            return { ...l, tiers: newTiers };
        }));
        setOpenMenuId(null);
    };

    const moveRow = (index: number, delta: number) => {
        if (!activeList) return;
        let newTiers = [...activeList.tiers];
        const targetIndex = index + delta;
        if (targetIndex < 0 || targetIndex >= newTiers.length) return;

        [newTiers[index], newTiers[targetIndex]] = [newTiers[targetIndex], newTiers[index]];

        // Enforce color order after moving
        newTiers = newTiers.map((t, i) => ({
            ...t,
            color: TIER_COLORS[i % TIER_COLORS.length]
        }));

        setLists(lists.map(l => l.id === activeListId ? { ...l, tiers: newTiers } : l));
    };

    const exportAsImage = async () => {
        if (!tierListRef.current) return;

        const width = tierListRef.current.offsetWidth;
        const dataUrl = await htmlToImage.toPng(tierListRef.current, { 
            backgroundColor: '#121212',
            width: width,
            style: {
                width: `${width}px`
            },
            filter: (node) => {
                if (!(node instanceof HTMLElement)) return true;
                
                // Hide the settings/arrows container in the exported image
                if (node.classList.contains('tier-settings')) return false;

                // Hide empty tier rows in the image to prevent layout gaps
                if (node.classList.contains('tier-row')) {
                    const items = node.querySelector('.tier-items');
                    if (items && items.children.length === 0) return false;
                }
                
                return true;
            }
        });
        const link = document.createElement('a');
        link.download = `${activeList?.name || 'tier-list'}.png`;
        link.href = dataUrl;
        link.click();
    };

    // Drag and Drop Logic
    const onDragStart = (name: string, sourceId: string, index: number) => {
        setDraggedPokemon({ name, sourceId, index });
    };

    const onDragOver = (e: React.DragEvent, targetTierId: string, targetIndex: number) => {
        e.stopPropagation();
        e.preventDefault();
        if (!draggedPokemon || !activeList) return;
        const { name, sourceId, index: sourceIndex } = draggedPokemon;

        // Prevent self-drop to the exact same spot if dragging within the same container
        if (sourceId === targetTierId) {
            if (sourceId === 'pool' && !poolSearch) { // Only check for exact spot if no search is active
                if (pool[targetIndex] === name) return;
            } else if (sourceId !== 'pool') {
                const currentTier = activeList.tiers.find(t => t.id === sourceId);
                if (currentTier && currentTier.pokemon[targetIndex] === name) return;
            }
        }

        // Handle dropping into the pool
        if (targetTierId === 'pool') {
            // If dragging from a tier to the pool
            if (sourceId !== 'pool') {
                setLists(lists.map(l => l.id === activeListId ? {
                    ...l,
                    tiers: l.tiers.map(t => t.id === sourceId ? { ...t, pokemon: t.pokemon.filter(p => p !== name) } : t)
                } : l));

                setPool(prev => {
                    const updated = prev.filter(p => p !== name);
                    updated.splice(targetIndex, 0, name);
                    return updated;
                });
                setDraggedPokemon({ name, sourceId: 'pool', index: targetIndex });
            } else if (!poolSearch) {
                // Internal pool reordering (disabled during search to prevent index mismatch)
                setPool(prev => {
                    const updated = prev.filter(p => p !== name);
                    updated.splice(targetIndex, 0, name);
                    return updated;
                });
                setDraggedPokemon({ name, sourceId: 'pool', index: targetIndex });
            }
        } else {
            // Handle dropping into a tier
            setLists(lists.map(list => {
                if (list.id !== activeListId) return list;
                const newTiers = list.tiers.map(tier => {
                    let newPkmn = [...tier.pokemon];
                    if (tier.id === sourceId) newPkmn = newPkmn.filter(p => p !== name);
                    if (tier.id === targetTierId) {
                        newPkmn.splice(targetIndex, 0, name); // targetIndex is correct for tier
                    }
                    return { ...tier, pokemon: newPkmn };
                });
                return { ...list, tiers: newTiers };
            }));
            setDraggedPokemon({ name, sourceId: targetTierId, index: targetIndex });
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDraggedPokemon(null);
    };

    const getPokemonImage = (name: string) => {
        return `/baseforms/${name}.png`;
    };

    const handleLabelClick = (tierId: string) => {
        const span = labelRefs.current[tierId];
        if (span) {
            span.focus();
        }
    };

    if (!activeList) return <div className="tier-list-container">Generating list...</div>;

    return (
        <section className="tier-list-tab">
            <div className="tier-list-controls">
                <div className="list-selector">
                    {lists.map(l => (
                        <button 
                            key={l.id} 
                            className={`list-btn ${l.id === activeListId ? 'active' : ''}`}
                            onClick={() => setActiveListId(l.id)}
                        >
                            {l.name}
                        </button>
                    ))}
                    <div className="list-action-btns">
                        {lists.length < 6 && <button className="add-list-btn" onClick={handleAddList} title="Add New List">+</button>}
                        {activeList && lists.length < 6 && <button className="copy-list-btn" onClick={handleDuplicateList} title="Duplicate Current List"><FaCopy /></button>}
                        {!isDefaultList && (
                            <button className="delete-list-btn" onClick={() => handleDeleteList(activeListId!)} title="Delete List"><FaTrash /></button>
                        )}
                    </div> 
                </div>

                <div className="action-btns-row">
                    <div className="slider-container">
                        <span>Size</span>
                        <input 
                            type="range" 
                            min="30" 
                            max="100" 
                            value={squareSize} 
                            onChange={(e) => setSquareSize(parseInt(e.target.value))}
                            className="size-slider"
                        />
                    </div>
                    <div className="btn-group">
                        <button 
                            className={`util-btn ${showComparison ? 'active' : ''}`} 
                            onClick={() => setShowComparison(!showComparison)}
                        >
                            {showComparison ? 'Hide Comparison' : 'Show Comparison'}
                        </button>
                        <button className="util-btn" onClick={exportAsImage}>Export PNG</button>
                        <button className="reset-btn" onClick={handleReset}>{isDefaultList ? 'Reset' : 'Reset to Pool'}</button>
                    </div>
                </div>
            </div>

            <div className="tier-list-export-area" ref={tierListRef}>
                <div className="tier-list-header">
                    <input 
                        className="list-name-input"
                        value={activeList.name}
                        onChange={(e) => setLists(lists.map(l => l.id === activeListId ? { ...l, name: e.target.value } : l))}
                    />
                </div>
                <div className="tier-rows-container">
                    {activeList.tiers.map((tier, rowIdx) => (
                        <div 
                            key={tier.id} 
                            className="tier-row"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                        >
                            <div 
                                className="tier-label" 
                                style={{ backgroundColor: tier.color }}
                                onClick={() => handleLabelClick(tier.id)}
                            >
                                <span 
                                    ref={(el) => { labelRefs.current[tier.id] = el; }}
                                    contentEditable 
                                    suppressContentEditableWarning
                                    onBlur={(e) => updateTierName(tier.id, e.target.innerText)}
                                >
                                    {tier.name}
                                </span>
                            </div>
                            <div 
                                className="tier-items"
                                onDragOver={(e) => onDragOver(e, tier.id, tier.pokemon.length)}
                            >
                                {tier.pokemon.map((name, idx) => (
                                    <div 
                                        key={name} 
                                        className="pokemon-square"
                                        draggable
                                        onDragStart={() => onDragStart(name, tier.id, idx)}
                                        onDragOver={(e) => onDragOver(e, tier.id, idx)}
                                        style={{ 
                                            width: `${squareSize}px`, 
                                            height: `${squareSize}px`,
                                            flexBasis: `${squareSize}px`
                                        }}
                                    >
                                        {showComparison && (() => {
                                            const defIdx = defaultRanks.get(name);
                                            const currIdx = currentRanks.get(name);
                                            if (defIdx === undefined || currIdx === undefined || defIdx === currIdx) return null;
                                            const diff = defIdx - currIdx;
                                            return (
                                                <div 
                                                    className="rank-badge" 
                                                    style={{ backgroundColor: diff > 0 ? '#4caf50' : '#f44336' }}
                                                >
                                                    {diff > 0 ? `+${diff}` : diff}
                                                </div>
                                            );
                                        })()}
                                        <img src={getPokemonImage(name)} alt={name} title={name} />
                                    </div>
                                ))}
                            </div>
                            <div className="tier-settings">
                                {rowIdx !== 0 && (
                                    <button 
                                        className="move-arrow" 
                                        onClick={() => moveRow(rowIdx, -1)}
                                    >
                                        <FaArrowUp />
                                    </button>
                                )}
                                <button className="settings-cog" onClick={() => setOpenMenuId(openMenuId === tier.id ? null : tier.id)}>
                                    <FaCog />
                                </button>
                                {rowIdx !== activeList.tiers.length - 1 && (
                                    <button 
                                        className="move-arrow" 
                                        onClick={() => moveRow(rowIdx, 1)}
                                    >
                                        <FaArrowDown />
                                    </button>
                                )}
    
                                {openMenuId === tier.id && (
                                    <div className="settings-menu">
                                        <button onClick={() => modifyRows(tier.id, 'above')}>Add Row Above</button>
                                        <button onClick={() => modifyRows(tier.id, 'below')}>Add Row Below</button>
                                        <button onClick={() => modifyRows(tier.id, 'delete')} className="danger">Delete Row</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="pokemon-pool-container">
                <div className="pokemon-pool-header">
                    <h3>Pokémon Pool</h3>
                    <input
                        type="text"
                        className="pool-search-input"
                        placeholder="Search Pokémon..."
                        value={poolSearch}
                        onChange={(e) => setPoolSearch(e.target.value)}
                    />
                </div>
                <div 
                    className="pool-items"
                    onDragOver={(e) => onDragOver(e, 'pool', filteredPool.length)}
                    onDrop={handleDrop}
                >
                    {filteredPool.map((name, idx) => (
                        <div 
                            key={name} 
                            className="pokemon-square"
                            draggable
                            onDragStart={() => onDragStart(name, 'pool', idx)}
                            onDragOver={(e) => onDragOver(e, 'pool', idx)}
                            style={{ width: `${squareSize}px`, height: `${squareSize}px`, flexBasis: `${squareSize}px` }}
                        >
                            <img src={getPokemonImage(name)} alt={name} title={name} />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default TierListTab;