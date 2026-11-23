import { StatsAuction } from '../../types';

export function oneVOneLeftoverOrders(auctions: StatsAuction[]): Map<string, number> {
  const orders = new Map<string, number>();
  auctions.forEach((auction) => {
    if (auction.draft_type !== '1v1' || auction.action !== 'LEFTOVER') return;
    const previous = orders.get(auction.draft_id);
    if (previous === undefined || auction.draft_order < previous) {
      orders.set(auction.draft_id, auction.draft_order);
    }
  });
  return orders;
}

export function casualOneVOneDraftIds(auctions: StatsAuction[]): Set<string> {
  return new Set(Array.from(oneVOneLeftoverOrders(auctions))
    .filter(([, order]) => order > 29)
    .map(([id]) => id));
}

export function oneVOnePickSlot(auction: StatsAuction, leftoverOrders: Map<string, number>): number | null {
  const leftoverOrder = leftoverOrders.get(auction.draft_id) ?? 29;
  if (auction.action === 'LEFTOVER') return leftoverOrder;
  if ((auction.action === 'PICK' || auction.action === 'BAN') && auction.draft_order >= 1 && auction.draft_order < leftoverOrder) {
    return auction.draft_order;
  }
  return null;
}

/**
 * Whether a 1v1 slot was a ban (or an unclaimed leftover, shown as 29).
 * `action` is authoritative; the fixed slot order is the fallback for older
 * rows that predate it: 1-4 are picks, then bans are the odd slots from 5 on.
 */
export function isOneVOneBan(auction: StatsAuction, pickNumber: number | null): boolean {
  if (auction.action === 'BAN') return true;
  if (auction.action === 'PICK') return false;
  if (auction.action === 'LEFTOVER' || pickNumber === 29) return true;
  return pickNumber !== null && pickNumber >= 5 && pickNumber % 2 === 1;
}