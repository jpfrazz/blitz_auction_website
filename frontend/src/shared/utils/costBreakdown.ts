import { StatsAuction } from '../../types';

export interface PokemonAggregate {
  key: string;
  name: string;
  form: string;
  bidsWon: number;
  totalSpend: number;
  avgWinningBid: number;
  minBid: number;
  maxBid: number;
  priceVariance: number;
  rank: number;
  recentMovement: number;
  priceMovement: number;
  avgOneVOnePick: number | null;
  total1v1Picks: number;
  pickMovement: number;
  types: string[];
}

export interface PokemonSaleRow {
  key: string;
  name: string;
  form: string;
  bid: number;
  types: string[];
}

const calculateQuantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
};

export interface ComputeCostBreakdownParams {
  auctions: StatsAuction[];
  legacy?: Array<{ pokemon: string; cost: string; date: string | null }>;
  cutoffDate?: string;
  lookbackWindow?: number;
  typeFilter?: string | null;
  includeLegacy?: boolean;
}

export function computeCostBreakdown({
  auctions,
  legacy = [],
  cutoffDate,
  lookbackWindow,
  typeFilter,
  includeLegacy = true,
}: ComputeCostBreakdownParams): PokemonAggregate[] {
  const cutoff = cutoffDate ? new Date(cutoffDate + 'T23:59:59') : null;
  const now = new Date();
  const lookbackDate = lookbackWindow && lookbackWindow > 0 ? new Date(now.getTime() - lookbackWindow * 24 * 60 * 60 * 1000) : null;

  const saleRows: PokemonSaleRow[] = [];
  for (const a of auctions) {
    if (a.draft_type === '1v1') continue;
    if (a.winning_bid === null || a.winning_bid === undefined) continue;
    const bid = a.winning_bid;
    if (bid === 100) continue;

    const auctionDate = a.updated_at ? new Date(a.updated_at) : (a.created_at ? new Date(a.created_at) : null);
    if (cutoff && auctionDate && auctionDate > cutoff) continue;
    if (lookbackDate && auctionDate && auctionDate < lookbackDate) continue;

    const name = a.name || '';
    // Remove Larvesta from cost breakdown
    if (name.toLowerCase() === 'larvesta') continue;
    const form = a.form || '';
    const key = form ? name + '-' + form : name;
    saleRows.push({ key, name, form, bid, types: [] });
  }

  const pickRows: Array<{ key: string; name: string; form: string }> = [];
  for (const a of auctions) {
    if (a.draft_type !== '1v1') continue;
    const name = a.name || '';
    const form = a.form || '';
    const key = form ? name + '-' + form : name;
    pickRows.push({ key, name, form });
  }

  const grouped = new Map<string, { key: string; name: string; form: string; bids: number[]; types: Set<string> }>();
  for (const s of saleRows) {
    let g = grouped.get(s.key);
    if (!g) {
      g = { key: s.key, name: s.name, form: s.form, bids: [], types: new Set<string>() };
      grouped.set(s.key, g);
    }
    g.bids.push(s.bid);
  }

  const pickGrouped = new Map<string, { key: string; name: string; form: string; count: number }>();
  for (const p of pickRows) {
    let g = pickGrouped.get(p.key);
    if (!g) {
      g = { key: p.key, name: p.name, form: p.form, count: 0 };
      grouped.has(p.key) || grouped.set(p.key, { key: p.key, name: p.name, form: p.form, bids: [], types: new Set<string>() });
      pickGrouped.set(p.key, g);
    }
    g.count += 1;
  }

  if (includeLegacy) {
    for (const l of legacy) {
      const name = l.pokemon || '';
      let form = '';
      let baseName = name;
      const dashIndex = name.indexOf('-');
      if (dashIndex >= 0 && name.slice(dashIndex + 1)) {
        baseName = name.slice(0, dashIndex);
        form = name.slice(dashIndex + 1);
      }
      const key = form ? baseName + '-' + form : baseName;
      const costNum = parseFloat(l.cost || '0');
      if (!Number.isNaN(costNum) && costNum > 0) {
        let g = grouped.get(key);
        if (!g) {
          g = { key, name: baseName, form, bids: [], types: new Set<string>() };
          grouped.set(key, g);
        }
        g.bids.push(costNum);
      }
    }
  }

  let results: PokemonAggregate[] = Array.from(grouped.values()).map((entry) => {
    // Filter out $100 sales and apply IQR outlier filtering (same as PokemonStatsTab)
    let bids = entry.bids.filter((b) => b !== 100);
    if (bids.length > 1) {
      const sortedBids = [...bids].sort((a, b) => a - b);
      const q1 = calculateQuantile(sortedBids, 0.25);
      const q3 = calculateQuantile(sortedBids, 0.75);
      const iqr = q3 - q1;
      if (iqr > 0) {
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 2.0 * iqr;
        bids = sortedBids.filter((b) => b >= lower && b <= upper);
      }
    }
    if (bids.length === 0) return null as any;
    const count = bids.length;
    const sum = bids.reduce((a, b) => a + b, 0);
    const avg = count > 0 ? Math.round(sum / count) : 0;
    const min = count > 0 ? Math.min(...bids) : 0;
    const max = count > 0 ? Math.max(...bids) : 0;
    const priceVariance = max - min;

    const pickEntry = pickGrouped.get(entry.key);
    const avgOneVOnePick = pickEntry && pickEntry.count > 0 ? Number((pickEntry.count).toFixed(2)) : null;
    const total1vOnePicksCount = pickEntry?.count || 0;

    return {
      key: entry.key,
      name: entry.name,
      form: entry.form,
      bidsWon: count,
      totalSpend: sum,
      avgWinningBid: avg,
      minBid: min,
      maxBid: max,
      priceVariance,
      rank: 0,
      recentMovement: 0,
      priceMovement: 0,
      avgOneVOnePick,
      total1v1Picks: total1vOnePicksCount,
      pickMovement: 0,
      types: Array.from(entry.types),
    };
  });

  if (typeFilter) {
    results = results.filter((r) => r.types.length === 0 ? false : r.types.some((t) => t.toLowerCase() === typeFilter.toLowerCase()));
  }

  results.sort((a, b) => {
    if (b.avgWinningBid !== a.avgWinningBid) return b.avgWinningBid - a.avgWinningBid;
    return a.name.localeCompare(b.name);
  });
  results.forEach((r, i) => (r.rank = i + 1));

  return results;
}



export function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[\n\r",]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export interface CostBreakdownCsvOptions {
  includeLegacy?: boolean;
  includePicks?: boolean;
  filename?: string;
}

export function downloadCostBreakdownCsv(
  aggregates: PokemonAggregate[],
  options: CostBreakdownCsvOptions = {}
): void {
  const includePicks = options.includePicks !== false;
  const filename = options.filename || "cost-breakdown.csv";
  const headers = ['Rank','Pokemon','Form','Key','Avg Price','Min Price','Max Price','Price Variance','Total Sales','Total Spend'];
  if (includePicks) { headers.push('Avg 1v1 Pick'); headers.push('Total Picks'); }
  let csv = headers.map(escapeCsvValue).join(",") + "\n";
  for (const r of aggregates) {
    const row: any[] = [r.rank, r.name, r.form, r.key, r.avgWinningBid, r.minBid, r.maxBid, r.priceVariance, r.bidsWon, r.totalSpend];
    if (includePicks) { row.push(r.avgOneVOnePick ?? ''); row.push(r.total1v1Picks); }
    csv += row.map(escapeCsvValue).join(",") + "\n";
  }
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
