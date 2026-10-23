/** Turn-based battle rules, independent of rendering. One card per turn. */
export interface BattleState {
  maxHp: number;
  playerHp: number;
  foeHp: number;
  turn: number;
  total: number;
  phase: "question" | "feedback" | "won" | "lost";
  lastHit: { target: "foe" | "player"; amount: number; crit: boolean } | null;
}

export interface TurnOutcome {
  correct: boolean;
  /** Free-text score (0-3), when the card was graded. */
  score?: number;
}

export const MAX_HP = 100;
export const PLAYER_HIT = 34;

export function startBattle(cards: number): BattleState {
  return { maxHp: MAX_HP, playerHp: MAX_HP, foeHp: MAX_HP, turn: 0, total: cards, phase: cards > 0 ? "question" : "won", lastHit: null };
}

/** Damage that clears the foe if every card is answered correctly. */
export const foeHit = (total: number) => Math.ceil(MAX_HP / Math.max(1, total));

/**
 * A correct answer hits the foe (a full-marks free-text answer is a critical hit); a wrong one hits the player.
 * Three misses lose the battle. Running out of cards with the foe standing also loses, so the hire retries.
 */
export function applyTurn(state: BattleState, outcome: TurnOutcome): BattleState {
  if (state.phase !== "question") return state;
  const crit = outcome.correct && outcome.score === 3;
  let { playerHp, foeHp } = state;
  let lastHit: BattleState["lastHit"];
  if (outcome.correct) {
    const amount = Math.round(foeHit(state.total) * (crit ? 1.5 : 1));
    foeHp = Math.max(0, foeHp - amount);
    lastHit = { target: "foe", amount, crit };
  } else {
    playerHp = Math.max(0, playerHp - PLAYER_HIT);
    lastHit = { target: "player", amount: PLAYER_HIT, crit: false };
  }
  return { ...state, playerHp, foeHp, turn: state.turn + 1, phase: "feedback", lastHit };
}

/** Moves on from the feedback screen: to the next card, or to the result. */
export function nextTurn(state: BattleState): BattleState {
  if (state.phase !== "feedback") return state;
  if (state.foeHp <= 0) return { ...state, phase: "won" };
  if (state.playerHp <= 0 || state.turn >= state.total) return { ...state, phase: "lost" };
  return { ...state, phase: "question" };
}
