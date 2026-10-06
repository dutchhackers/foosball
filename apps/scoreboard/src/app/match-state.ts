/**
 * Pure, immutable live-match state for the scoreboard.
 *
 * Team colours map onto the API's home/away convention:
 * red = home = finalScore[0], blue = away = finalScore[1].
 */

export type TeamColor = 'red' | 'blue';

export interface ScoreboardPlayer {
  id: string;
  name: string;
  nickname?: string;
  displayName?: string;
  avatar?: string;
}

export interface GoalEvent {
  /** Team that gets the point. */
  team: TeamColor;
  /** Player who touched the ball last (optional, voice may not catch it). */
  playerId?: string;
  ownGoal: boolean;
  at: string;
}

export interface MatchState {
  /** `confirming`: end_match asked for confirmation; scoring is locked until the human submits or cancels. */
  status: 'idle' | 'in_progress' | 'confirming';
  red: ScoreboardPlayer[];
  blue: ScoreboardPlayer[];
  goals: GoalEvent[];
  startedAt?: string;
  /** Score snapshot taken when the confirmation opened; this is what gets submitted. */
  pendingFinalScore?: [number, number];
}

export const MAX_SCORE = 11;

export const initialMatchState: MatchState = { status: 'idle', red: [], blue: [], goals: [] };

export function otherTeam(team: TeamColor): TeamColor {
  return team === 'red' ? 'blue' : 'red';
}

export function startMatch(red: ScoreboardPlayer[], blue: ScoreboardPlayer[], now = new Date().toISOString()): MatchState {
  if (red.length < 1 || red.length > 2 || red.length !== blue.length) {
    throw new Error(`Only 1v1 or 2v2 is supported (got ${red.length}v${blue.length}).`);
  }
  const ids = [...red, ...blue].map(p => p.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('A player cannot appear twice in one match.');
  }
  return { status: 'in_progress', red: [...red], blue: [...blue], goals: [], startedAt: now };
}

function assertScoring(state: MatchState): void {
  if (state.status === 'confirming') {
    throw new Error('The end-of-match confirmation is open. Cancel it on screen before changing the score.');
  }
  if (state.status !== 'in_progress') {
    throw new Error('No match in progress. Start a match first.');
  }
}

export function score(state: MatchState): [number, number] {
  let red = 0;
  let blue = 0;
  for (const goal of state.goals) {
    if (goal.team === 'red') red++;
    else blue++;
  }
  return [red, blue];
}

export function teamOf(state: MatchState, playerId: string): TeamColor | undefined {
  if (state.red.some(p => p.id === playerId)) return 'red';
  if (state.blue.some(p => p.id === playerId)) return 'blue';
  return undefined;
}

/**
 * Record a goal. `scoringTeam` is the team the voice command named; for an own goal the
 * point goes to the opposite team. When a player is given, the player must be in the match.
 */
export function recordGoal(
  state: MatchState,
  input: { team: TeamColor; playerId?: string; ownGoal?: boolean },
  now = new Date().toISOString()
): MatchState {
  assertScoring(state);
  const ownGoal = input.ownGoal === true;
  if (input.playerId) {
    const playerTeam = teamOf(state, input.playerId);
    if (!playerTeam) {
      throw new Error('That player is not in this match.');
    }
    // For a normal goal the player must be on the team that scores; for an own goal on the other team.
    const expected = ownGoal ? otherTeam(input.team) : input.team;
    if (playerTeam !== expected) {
      throw new Error(`That player plays for ${playerTeam}, not ${expected}.`);
    }
  }
  const [red, blue] = score(state);
  const current = input.team === 'red' ? red : blue;
  if (current >= MAX_SCORE) {
    throw new Error(`${input.team} already has ${MAX_SCORE}; scores cannot exceed ${MAX_SCORE}.`);
  }
  const goal: GoalEvent = { team: input.team, ownGoal, at: now };
  if (input.playerId) goal.playerId = input.playerId;
  return { ...state, goals: [...state.goals, goal] };
}

export function undoGoal(state: MatchState): { state: MatchState; removed?: GoalEvent } {
  assertScoring(state);
  if (state.goals.length === 0) {
    return { state };
  }
  const removed = state.goals[state.goals.length - 1];
  return { state: { ...state, goals: state.goals.slice(0, -1) }, removed };
}

/**
 * Mirrors the rules in MatchService.validateAddMatchResultInput (libs/common), plus one
 * stricter rule for a live match: somebody must have reached 10 before the match can end.
 * Returns an error message, or null when the score can be submitted.
 */
export function validateFinalScore([a, b]: [number, number]): string | null {
  if (a < 0 || b < 0) return 'Scores cannot be negative.';
  if (a > MAX_SCORE || b > MAX_SCORE) return `Scores cannot exceed ${MAX_SCORE}.`;
  const max = Math.max(a, b);
  const min = Math.min(a, b);
  if (max < 10) return `Nobody has reached 10 yet (${a}-${b}).`;
  if (max === 10 && min >= 10) return 'A 10-10 tie is not a final score; play to 11.';
  if (max === 11 && min > 10) return 'Cannot end at 11-11.';
  return null;
}

/** Open the end-of-match confirmation. Throws when the score is not a valid final score. */
export function requestEnd(state: MatchState): MatchState {
  if (state.status === 'confirming') return state;
  if (state.status !== 'in_progress') {
    throw new Error('No match in progress.');
  }
  const finalScore = score(state);
  const problem = validateFinalScore(finalScore);
  if (problem) {
    throw new Error(problem);
  }
  return { ...state, status: 'confirming', pendingFinalScore: finalScore };
}

export function cancelEnd(state: MatchState): MatchState {
  if (state.status !== 'confirming') return state;
  const next: MatchState = { ...state, status: 'in_progress' };
  delete next.pendingFinalScore;
  return next;
}
