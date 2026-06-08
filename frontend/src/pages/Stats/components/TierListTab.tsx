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

const TIER_COLORS = [
    '#ff7f7f', // Red
    '#ffbf7f', // Dark Orange
    '#ffff7f', // Yellow
    '#bfff7f', // Lime
    '#7fff7f', // Green
    '#7fffbf', // Teal
    '#7fffff', // Cyan
    '#7fbfff', // Light Blue
    '#7f7fff', // Blue
    '#bf7fff', // Purple
    '#ff7fff', // Pink
];

const DEFAULT_TIERS_CONFIG = [
    { id: 'tier-s', name: 'S', color: '#ff7f7f' },
    { id: 'tier-ap', name: 'A+', color: '#ffbf7f' },
    { id: 'tier-a', name: 'A', color: '#ffff7f' },
    { id: 'tier-am', name: 'A-', color: '#bfff7f' },
    { id: 'tier-bp', name: 'B+', color: '#7fff7f' },
    { id: 'tier-b', name: 'B', color: '#7fffbf' },
    { id: 'tier-bm', name: 'B-', color: '#7fffff' },
    { id: 'tier-cp', name: 'C+', color: '#7fbfff' },
    { id: 'tier-c', name: 'C', color: '#7f7fff' },
    { id: 'tier-d', name: 'D', color: '#bf7fff' },
    { id: 'tier-f', name: 'F', color: '#ff7fff' },
];

function formatPokemonName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.startsWith("farfetch'd")) return "farfetch'd";
    return lower.replace(/'/g, '');
}

const TierListTab: React.FC<TierListTabProps> = ({ stats }) => {
    const [lists, setLists] = useState<TierListData[]>([]);
    const [squareSize, setSquareSize] = useState(60);
    const [showComparison, setShowComparison] = useState(false);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [draggedPokemon, setDraggedPokemon] = useState<{ name: string; sourceId: string; index: number } | null>(null);
    
    const tierListRef = useRef<HTMLDivElement>(null);
    const labelRefs = useRef<Record<string, HTMLSpanElement | null>>({});

    const isDefaultList = activeListId === 'default-stats-list';

    const allPokemon = useMemo(() => {
        if (!stats) return [];
        const map = new Map<string, { total: number; count: number }>();
        
        stats.auctions.forEach(a => {
            if (a.winning_bid === null || excludedPokemonNames.has(a.name)) return;
            const curr = map.get(a.name) || { total: 0, count: 0 };
            curr.total += a.winning_bid;
            curr.count += 1;
            map.set(a.name, curr);
        });

        stats.legacy?.forEach(l => {
            if (excludedPokemonNames.has(l.pokemon)) return;
            const cost = parseInt(l.cost.toString().replace(/[^0-9]/g, ''), 10);
            if (isNaN(cost)) return;
            const curr = map.get(l.pokemon) || { total: 0, count: 0 };
            curr.total += cost;
            curr.count += 1;
            map.set(l.pokemon, curr);
        });

        return Array.from(map.entries())
            .map(([name, data]) => ({
                name,
                avg: data.total / data.count
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [stats]);

    const generateDefaultTiers = useMemo(() => {
        const ranges = [
            "$4500+", "$4250-4500", "$4000-4250", "$3750-4000", "$3500-3750",
            "$3250-3500", "$3000-3250", "$2750-3000", "$2500-2750", "$2000-2500", "<$2000"
        ];
        const defaultTiers = DEFAULT_TIERS_CONFIG.map((config, idx) => ({
            ...config,
            name: `${config.name}\n${ranges[idx]}`,
            pokemon: [] as string[]
        }));

        allPokemon.forEach(p => {
            if (p.avg >= 4500) defaultTiers[0].pokemon.push(p.name);
            else if (p.avg >= 4250) defaultTiers[1].pokemon.push(p.name);
            else if (p.avg >= 4000) defaultTiers[2].pokemon.push(p.name);
            else if (p.avg >= 3750) defaultTiers[3].pokemon.push(p.name);
            else if (p.avg >= 3500) defaultTiers[4].pokemon.push(p.name);
            else if (p.avg >= 3250) defaultTiers[5].pokemon.push(p.name);
            else if (p.avg >= 3000) defaultTiers[6].pokemon.push(p.name);
            else if (p.avg >= 2750) defaultTiers[7].pokemon.push(p.name);
            else if (p.avg >= 2500) defaultTiers[8].pokemon.push(p.name);
            else if (p.avg >= 2000) defaultTiers[9].pokemon.push(p.name);
            else defaultTiers[10].pokemon.push(p.name);
        });
        return defaultTiers;
    }, [allPokemon]);

    // 2. Load from LocalStorage or Generate Default
    useEffect(() => {
        const saved = localStorage.getItem('blitz_tier_lists');
        if (saved) {
            const parsed = JSON.parse(saved);
            setLists(parsed);
            if (parsed.length > 0) setActiveListId(parsed[0].id);
        } else if (generateDefaultTiers.some(t => t.pokemon.length > 0)) {
            const initialList: TierListData = {
                id: 'default-stats-list',
                name: 'Stats Based Tier List',
                tiers: generateDefaultTiers
            };
            setLists([initialList]);
            setActiveListId(initialList.id);
        }
    }, [allPokemon, generateDefaultTiers]);

    useEffect(() => {
        if (lists.length > 0 && activeListId) {
            // Enforce color order based on current indices whenever lists change
            const coloredLists = lists.map(list => ({
                ...list,
                tiers: list.tiers.map((t, idx) => ({
                    ...t,
                    color: TIER_COLORS[idx % TIER_COLORS.length]
                }))
            }));
            localStorage.setItem('blitz_tier_lists', JSON.stringify(coloredLists));
        }
    }, [lists]);

    const activeList = lists.find(l => l.id === activeListId);

    // Maintain a local pool state if needed, but here we derive it
    const tieredNames = useMemo(() => {
        if (!activeList) return new Set<string>();
        return new Set(activeList.tiers.flatMap(t => t.pokemon));
    }, [activeList]);

    const [pool, setPool] = useState<string[]>([]);
    useEffect(() => {
        setPool(allPokemon.filter(p => !tieredNames.has(p.name)).map(p => p.name));
    }, [allPokemon, tieredNames]);

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
        if (!isDefaultList) {
            setPool(allPokemon.map(p => p.name));
        }
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
        if (!draggedPokemon || !activeListId) return;
        const { name, sourceId, index: sourceIndex } = draggedPokemon;

        if (sourceId === targetTierId && sourceIndex === targetIndex) return;

        if (targetTierId === 'pool') {
            const newPool = [...pool].filter(p => p !== name);
            newPool.splice(targetIndex, 0, name);
            setPool(newPool);

            if (sourceId !== 'pool') {
                setLists(lists.map(l => l.id === activeListId ? {
                    ...l,
                    tiers: l.tiers.map(t => t.id === sourceId ? { ...t, pokemon: t.pokemon.filter(p => p !== name) } : t)
                } : l));
            }
            setDraggedPokemon({ name, sourceId: 'pool', index: targetIndex });
        } else {
            setLists(lists.map(list => {
                if (list.id !== activeListId) return list;
                const newTiers = list.tiers.map(tier => {
                    let newPkmn = [...tier.pokemon];
                    if (tier.id === sourceId) newPkmn = newPkmn.filter(p => p !== name);
                    if (tier.id === targetTierId) {
                        newPkmn.splice(targetIndex, 0, name);
                    }
                    return { ...tier, pokemon: newPkmn };
                });
                return { ...list, tiers: newTiers };
            }));
            
            if (sourceId === 'pool') {
                setPool(pool.filter(p => p !== name));
            }
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
                    <div className="list-action-btns"> {/* New container for action buttons */}
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

            <div className="tier-list-export-area" ref={tierListRef}> {/* New wrapper for export */}
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
                <h3>Pokémon Pool</h3>
                <div 
                    className="pool-items"
                    onDragOver={(e) => onDragOver(e, 'pool', pool.length)}
                    onDrop={handleDrop}
                >
                    {pool.map((name, idx) => (
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