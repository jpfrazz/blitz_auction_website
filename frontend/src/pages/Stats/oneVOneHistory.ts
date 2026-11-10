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