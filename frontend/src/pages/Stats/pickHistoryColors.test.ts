import {
  BAN_COLOR,
  OUTLIER_COLOR,
  PICK_COLOR,
  getPickHistoryDotColor,
} from './pickHistoryColors';

describe('pick history dot colors', () => {
  it('uses light blue for bans and 29s', () => {
    expect(getPickHistoryDotColor(true, false)).toBe(BAN_COLOR);
  });

  it('allows a ban or 29 to be red when it is an outlier', () => {
    expect(getPickHistoryDotColor(true, true)).toBe(OUTLIER_COLOR);
  });

  it('reserves red for outliers', () => {
    expect(getPickHistoryDotColor(false, true)).toBe(OUTLIER_COLOR);
  });

  it('uses green for ordinary picks', () => {
    expect(getPickHistoryDotColor(false, false)).toBe(PICK_COLOR);
  });
});
