// Beating Wally (656) or Steven (804) is the run's finish line. The trainer
// card win only appears in a .sav flush after the game has been beaten, so it
// is a reliable signal even though players often remain in the Lilycove Museum
// afterwards to fight more trainers.

interface TrainerCardWinsLike {
  trainer_card_wins?: Array<{ trainer_id: number; is_loss: boolean }> | null;
}

const CHAMPION_TRAINER_IDS = new Set([656, 804]);

const championWins = (save: TrainerCardWinsLike | null | undefined) =>
  (save?.trainer_card_wins ?? []).filter(w => !w.is_loss && CHAMPION_TRAINER_IDS.has(w.trainer_id));

/** True once the save records a win over Wally or Steven. */
export function hasChampionWin(save: TrainerCardWinsLike | null | undefined): boolean {
  return championWins(save).length > 0;
}

/** Name of the last champion win, for the "(Beat Steven!/Wally!)" display. */
export function getChampionName(save: TrainerCardWinsLike | null | undefined): string | null {
  const wins = championWins(save);
  if (wins.length === 0) return null;
  return wins[wins.length - 1].trainer_id === 804 ? 'Steven' : 'Wally';
}

/**
 * The finish marker is scoped to a draft: reloading a state or ROM keeps the
 * same key and stays finished, while a different draft starts fresh — even if
 * the router reuses the same emulator component instance.
 */
export function isRunFinishedFor(finishedDraftId: string | null, runKey: string): boolean {
  return finishedDraftId === runKey;
}
