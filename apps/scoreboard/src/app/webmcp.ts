/**
 * WebMCP tools for the live scoreboard.
 * Spec: https://webmachinelearning.github.io/webmcp/ (draft). Local types only, no polyfill:
 * without `document.modelContext` (or the older `navigator.modelContext`) registration is a no-op.
 */
import { GoalEvent, MatchState, recordGoal, requestEnd, ScoreboardPlayer, score, startMatch, TeamColor, undoGoal } from './match-state';
import { playerLabel, resolvePlayer, resolveTeams } from './player-resolver';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface ModelContextTool<I = Record<string, unknown>> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  annotations?: ToolAnnotations;
  execute: (input: I, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
}

export interface ModelContext {
  registerTool(tool: ModelContextTool<never>, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export const BUDGET = { name: 30, description: 500, paramDescription: 150, output: 1500 } as const;

/** What the tools need from the page. The page owns rendering and the confirmation dialog. */
export interface ScoreboardController {
  getPlayers(): Promise<ScoreboardPlayer[]>;
  getState(): MatchState;
  setState(state: MatchState): void;
  /** Show the end-of-match confirmation. Only a human click on it submits the result. */
  showEndConfirmation(): void;
}

export function text(message: string, isError = false): ToolResult {
  const clipped = message.length > BUDGET.output ? message.slice(0, BUDGET.output - 1) + '…' : message;
  return isError ? { content: [{ type: 'text', text: clipped }], isError: true } : { content: [{ type: 'text', text: clipped }] };
}

function teamNames(players: ScoreboardPlayer[]): string {
  return players.map(playerLabel).join(' & ');
}

export function summarize(state: MatchState): string {
  if (state.status === 'idle') {
    return 'No match in progress.';
  }
  const [red, blue] = score(state);
  return `Red (${teamNames(state.red)}) ${red} - ${blue} Blue (${teamNames(state.blue)}).`;
}

export function describeGoal(state: MatchState, goal: GoalEvent): string {
  const player = goal.playerId ? [...state.red, ...state.blue].find(p => p.id === goal.playerId) : undefined;
  const who = player ? ` by ${playerLabel(player)}` : '';
  return `${goal.ownGoal ? 'own goal' : 'goal'} for ${goal.team}${who}`;
}

async function guard(run: () => Promise<string> | string): Promise<ToolResult> {
  try {
    return text(await run());
  } catch (e) {
    return text((e as Error).message, true);
  }
}

const playerList = (description: string) => ({
  type: 'array',
  minItems: 1,
  maxItems: 2,
  items: { type: 'string' },
  description,
});

export function createScoreboardTools(ctrl: ScoreboardController): ModelContextTool<never>[] {
  const startTool: ModelContextTool<{ red: string[]; blue: string[] }> = {
    name: 'start_match',
    title: 'Start match',
    description:
      'Start a new foosball match on the scoreboard (1v1 or 2v2). Player names are matched against known players; ' +
      'if a name is ambiguous or unknown the tool returns an error with candidates, so ask the user which player they meant. ' +
      'Replaces a match that has no goals yet; refuses while a match with goals is running.',
    inputSchema: {
      type: 'object',
      properties: {
        red: playerList('Red team (home): one or two player names or nicknames.'),
        blue: playerList('Blue team (away): one or two player names or nicknames.'),
      },
      required: ['red', 'blue'],
    },
    annotations: { readOnlyHint: false },
    execute: input =>
      guard(async () => {
        const current = ctrl.getState();
        if (current.status !== 'idle' && current.goals.length > 0) {
          throw new Error(`A match is already running: ${summarize(current)} End or abandon it on screen first.`);
        }
        const players = await ctrl.getPlayers();
        const teams = resolveTeams(input.red ?? [], input.blue ?? [], players);
        const next = startMatch(teams.red, teams.blue);
        ctrl.setState(next);
        return `Match started. ${summarize(next)}`;
      }),
  };

  const goalTool: ModelContextTool<{ team: TeamColor; player?: string; ownGoal?: boolean }> = {
    name: 'record_goal',
    title: 'Record goal',
    description:
      'Add one point to the scoreboard of the running match, no confirmation needed. team is the team that GETS the point. ' +
      'For an own goal, set ownGoal true and name the player who put it in their own goal (they play for the other team). ' +
      'If the recognised goal was wrong, call undo_goal.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', enum: ['red', 'blue'], description: 'Team that gets the point.' },
        player: { type: 'string', description: 'Optional: name of the player who scored (or who made the own goal).' },
        ownGoal: { type: 'boolean', description: 'True when a player scored in their own goal; the point goes to team.' },
      },
      required: ['team'],
    },
    annotations: { readOnlyHint: false },
    execute: input =>
      guard(() => {
        if (input.team !== 'red' && input.team !== 'blue') {
          throw new Error('team must be "red" or "blue".');
        }
        const state = ctrl.getState();
        const playerId = input.player ? resolvePlayer(input.player, [...state.red, ...state.blue]).id : undefined;
        const next = recordGoal(state, { team: input.team, playerId, ownGoal: input.ownGoal });
        ctrl.setState(next);
        const goal = next.goals[next.goals.length - 1];
        return `Recorded ${describeGoal(next, goal)}. ${summarize(next)}`;
      }),
  };

  const undoTool: ModelContextTool<Record<string, never>> = {
    name: 'undo_goal',
    title: 'Undo last goal',
    description: 'Remove the most recently recorded goal from the running match, e.g. when speech recognition got it wrong.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
    execute: () =>
      guard(() => {
        const state = ctrl.getState();
        const { state: next, removed } = undoGoal(state);
        if (!removed) {
          return `Nothing to undo. ${summarize(state)}`;
        }
        ctrl.setState(next);
        return `Removed ${describeGoal(state, removed)}. ${summarize(next)}`;
      }),
  };

  const endTool: ModelContextTool<Record<string, never>> = {
    name: 'end_match',
    title: 'End match',
    description:
      'Finish the running match. This saves the result and updates player stats and leaderboards, so it never saves directly: ' +
      'it opens the confirmation on screen and a person must press Submit. Fails when the score is not a valid final score.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, consequentialHint: true },
    execute: () =>
      guard(() => {
        const next = requestEnd(ctrl.getState());
        ctrl.setState(next);
        ctrl.showEndConfirmation();
        return `Confirmation shown: ${summarize(next)} Ask a player to press Submit on the scoreboard to save it, or Cancel to continue.`;
      }),
  };

  return [startTool, goalTool, undoTool, endTool] as ModelContextTool<never>[];
}

export function getModelContext(doc: unknown = globalThis.document, nav: unknown = globalThis.navigator): ModelContext | undefined {
  const fromDoc = (doc as { modelContext?: ModelContext } | undefined)?.modelContext;
  const fromNav = (nav as { modelContext?: ModelContext } | undefined)?.modelContext;
  const ctx = fromDoc ?? fromNav;
  return ctx && typeof ctx.registerTool === 'function' ? ctx : undefined;
}

/** Registers the tools; returns false (no-op) when the browser has no WebMCP. Abort `signal` to unregister. */
export async function registerScoreboardTools(
  tools: ModelContextTool<never>[],
  signal: AbortSignal,
  ctx = getModelContext()
): Promise<boolean> {
  if (!ctx) return false;
  for (const tool of tools) {
    await ctx.registerTool(tool, { signal });
  }
  return true;
}
