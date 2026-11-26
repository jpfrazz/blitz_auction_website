import { isNonCasualRace } from './raceEligibility';

/** Minimal shape needed to decide whether a draft row passes the filters. */
export interface DraftBreakdownDraftRef {
  draftId: string;
  draftType?: string;
}

export interface DraftBreakdownFilterOptions {
  competitiveOnly: boolean;
  showAuctions: boolean;
  show1v1s: boolean;
  showBoosters: boolean;
  validDraftIds: Set<string>;
  casual1v1DraftIds: Set<string>;
  casualBoosterIds: Set<string>;
  finished1v1DraftIds: Set<string>;
}

/**
 * The type toggles decide which kinds of drafts appear at all. "Competitive
 * Drafts Only" never adds drafts on its own; it only removes casual drafts
 * from the types that are already enabled.
 */
export function isDraftBreakdownDraftVisible(
  draft: DraftBreakdownDraftRef,
  options: DraftBreakdownFilterOptions,
): boolean {
  const is1v1 = draft.draftType === '1v1';
  const isBooster = draft.draftType === 'booster';

  if (is1v1 && (!options.show1v1s || !options.finished1v1DraftIds.has(draft.draftId))) {
    return false;
  }
  if (isBooster && !options.showBoosters) {
    return false;
  }
  if (!is1v1 && !isBooster && !options.showAuctions) {
    return false;
  }
  if (!options.competitiveOnly) {
    return true;
  }

  return isNonCasualRace(
    { draft_id: draft.draftId, draft_type: draft.draftType },
    options.validDraftIds,
    options.casual1v1DraftIds,
    options.casualBoosterIds,
  );
}
