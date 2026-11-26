import {
  DraftBreakdownFilterOptions,
  isDraftBreakdownDraftVisible,
} from './draftBreakdownFilters';

const draft = (draftId: string, draftType?: string) => ({ draftId, draftType });

const options = (overrides: Partial<DraftBreakdownFilterOptions> = {}): DraftBreakdownFilterOptions => ({
  competitiveOnly: false,
  showAuctions: true,
  show1v1s: true,
  showBoosters: true,
  validDraftIds: new Set(['competitive-auction']),
  casual1v1DraftIds: new Set(['casual-1v1']),
  casualBoosterIds: new Set(['casual-booster']),
  finished1v1DraftIds: new Set(['competitive-1v1', 'casual-1v1']),
  ...overrides,
});

const drafts = [
  draft('competitive-auction', 'auction'),
  draft('casual-auction', 'auction'),
  draft('competitive-1v1', '1v1'),
  draft('casual-1v1', '1v1'),
  draft('unfinished-1v1', '1v1'),
  draft('competitive-booster', 'booster'),
  draft('casual-booster', 'booster'),
];

const visibleIds = (opts: DraftBreakdownFilterOptions) =>
  drafts.filter((item) => isDraftBreakdownDraftVisible(item, opts)).map((item) => item.draftId);

test('default filters show every completed draft, including casual ones', () => {
  expect(visibleIds(options())).toEqual([
    'competitive-auction',
    'casual-auction',
    'competitive-1v1',
    'casual-1v1',
    'competitive-booster',
    'casual-booster',
  ]);
});

test('competitive only never adds drafts by itself', () => {
  expect(visibleIds(options({
    competitiveOnly: true,
    showAuctions: false,
    show1v1s: false,
    showBoosters: false,
  }))).toEqual([]);
});

test('no type toggle selected shows nothing', () => {
  expect(visibleIds(options({
    showAuctions: false,
    show1v1s: false,
    showBoosters: false,
  }))).toEqual([]);
});

test.each([
  ['auctions', { showAuctions: true, show1v1s: false, showBoosters: false }, ['competitive-auction', 'casual-auction']],
  ['1v1s', { showAuctions: false, show1v1s: true, showBoosters: false }, ['competitive-1v1', 'casual-1v1']],
  ['boosters', { showAuctions: false, show1v1s: false, showBoosters: true }, ['competitive-booster', 'casual-booster']],
] as const)('only %s shows just that draft type', (_label, toggles, expected) => {
  expect(visibleIds(options({ ...toggles }))).toEqual(expected);
});

test('competitive only removes casual drafts of every enabled type', () => {
  expect(visibleIds(options({ competitiveOnly: true }))).toEqual([
    'competitive-auction',
    'competitive-1v1',
    'competitive-booster',
  ]);
});

test('competitive only combines with a single enabled type', () => {
  expect(visibleIds(options({
    competitiveOnly: true,
    showAuctions: false,
    show1v1s: false,
  }))).toEqual(['competitive-booster']);
});
