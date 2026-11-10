import { StatsAuction } from '../../types';
import { oneVOneLeftoverOrders, oneVOnePickSlot } from './oneVOneHistory';

const row = (draftId: string, order: number, action: StatsAuction['action']): StatsAuction => ({
  draft_id: draftId,
  draft_type: '1v1',
  draft_order: order,
  action,
} as StatsAuction);

test.each([32, 36, 40])('uses the final four pool entries for a %i Pokemon draft', (poolSize) => {
  const firstLeftover = poolSize - 3;
  const rows = [
    row('draft', firstLeftover + 3, 'LEFTOVER'),
    row('draft', firstLeftover, 'LEFTOVER'),
    row('draft', firstLeftover + 1, 'LEFTOVER'),
    row('draft', firstLeftover + 2, 'LEFTOVER'),
  ];
  const orders = oneVOneLeftoverOrders(rows);

  expect(orders.get('draft')).toBe(firstLeftover);
  rows.forEach((entry) => expect(oneVOnePickSlot(entry, orders)).toBe(firstLeftover));
  expect(oneVOnePickSlot(row('draft', firstLeftover - 1, 'PICK'), orders)).toBe(firstLeftover - 1);
  expect(oneVOnePickSlot(row('draft', poolSize + 1, 'BAN'), orders)).toBeNull();
});

test('defaults older drafts without leftover records to the 32 Pokemon boundary', () => {
  const orders = oneVOneLeftoverOrders([]);
  expect(oneVOnePickSlot(row('old', 28, 'BAN'), orders)).toBe(28);
  expect(oneVOnePickSlot(row('old', 29, 'BAN'), orders)).toBeNull();
});