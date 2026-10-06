import { fetchPlayers, readConfig, submitResult } from './app/config';
import {
  cancelEnd,
  initialMatchState,
  MatchState,
  recordGoal,
  requestEnd,
  score,
  ScoreboardPlayer,
  startMatch,
  undoGoal,
} from './app/match-state';
import { playerLabel, resolveTeams } from './app/player-resolver';
import { createScoreboardTools, describeGoal, registerScoreboardTools, ScoreboardController } from './app/webmcp';

const config = readConfig(location.search);
let state: MatchState = initialMatchState;
let playersPromise: Promise<ScoreboardPlayer[]> | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function getPlayers(): Promise<ScoreboardPlayer[]> {
  playersPromise ??= fetchPlayers(config).catch(e => {
    playersPromise = undefined;
    throw e;
  });
  return playersPromise;
}

function flash(message: string, isError = false): void {
  const el = $('status');
  el.textContent = message;
  el.dataset['error'] = String(isError);
}

function render(): void {
  const [red, blue] = score(state);
  $('red-score').textContent = String(red);
  $('blue-score').textContent = String(blue);
  $('red-names').textContent = state.red.map(playerLabel).join(' & ') || '—';
  $('blue-names').textContent = state.blue.map(playerLabel).join(' & ') || '—';
  document.body.dataset['status'] = state.status;

  const log = $('goal-log');
  log.replaceChildren(
    ...state.goals
      .map((goal, i) => {
        const li = document.createElement('li');
        li.className = goal.team;
        li.textContent = `${i + 1}. ${describeGoal(state, goal)}`;
        return li;
      })
      .reverse()
  );

  const scoring = state.status === 'in_progress';
  for (const id of ['add-red', 'add-blue', 'undo', 'end']) {
    $<HTMLButtonElement>(id).disabled = !scoring;
  }
  $('start-form').hidden = state.status !== 'idle' && state.goals.length > 0;
}

function setState(next: MatchState): void {
  state = next;
  render();
}

function act(run: () => void): void {
  try {
    run();
  } catch (e) {
    flash((e as Error).message, true);
  }
}

function showEndConfirmation(): void {
  const dialog = $<HTMLDialogElement>('confirm-end');
  const [red, blue] = state.pendingFinalScore ?? score(state);
  $('confirm-text').textContent = `Red (${state.red.map(playerLabel).join(' & ')}) ${red} - ${blue} Blue (${state.blue
    .map(playerLabel)
    .join(' & ')})`;
  $<HTMLButtonElement>('confirm-submit').disabled = false;
  if (!dialog.open) dialog.showModal();
}

async function submitPending(): Promise<void> {
  if (state.status !== 'confirming' || !state.pendingFinalScore) return;
  const button = $<HTMLButtonElement>('confirm-submit');
  button.disabled = true; // no idempotency key on the API, so never send twice
  try {
    const outcome = await submitResult(config, {
      homeTeamIds: state.red.map(p => p.id),
      awayTeamIds: state.blue.map(p => p.id),
      finalScore: state.pendingFinalScore,
      matchDate: state.startedAt,
    });
    $<HTMLDialogElement>('confirm-end').close('submitted');
    const [red, blue] = state.pendingFinalScore;
    setState(initialMatchState);
    flash(outcome === 'mock' ? `Mock mode: ${red}-${blue} not saved.` : `Saved ${red}-${blue}. Ratings updated.`);
  } catch (e) {
    button.disabled = false;
    flash((e as Error).message, true);
  }
}

function wireUi(): void {
  $('start-form').addEventListener('submit', event => {
    event.preventDefault();
    const split = (id: string) =>
      $<HTMLInputElement>(id)
        .value.split(',')
        .map(s => s.trim())
        .filter(Boolean);
    getPlayers()
      .then(players => {
        const teams = resolveTeams(split('red-input'), split('blue-input'), players);
        setState(startMatch(teams.red, teams.blue));
        flash('Match started.');
      })
      .catch(e => flash((e as Error).message, true));
  });
  $('add-red').addEventListener('click', () => act(() => setState(recordGoal(state, { team: 'red' }))));
  $('add-blue').addEventListener('click', () => act(() => setState(recordGoal(state, { team: 'blue' }))));
  $('undo').addEventListener('click', () => act(() => setState(undoGoal(state).state)));
  $('end').addEventListener('click', () =>
    act(() => {
      setState(requestEnd(state));
      showEndConfirmation();
    })
  );
  $('confirm-submit').addEventListener('click', () => void submitPending());
  // Cancel button, Escape and any other close resume the match.
  $<HTMLDialogElement>('confirm-end').addEventListener('close', () => {
    if (state.status === 'confirming') setState(cancelEnd(state));
  });
}

const controller: ScoreboardController = {
  getPlayers,
  getState: () => state,
  setState,
  showEndConfirmation,
};

wireUi();
render();

// Echo every agent call on screen, so players can hear-and-see what the assistant did.
const tools = createScoreboardTools(controller).map(tool => ({
  ...tool,
  execute: async (input: never) => {
    const result = await tool.execute(input);
    flash(`Assistant: ${result.content[0].text}`, result.isError === true);
    return result;
  },
}));
const abort = new AbortController();
window.addEventListener('pagehide', () => abort.abort());
registerScoreboardTools(tools, abort.signal).then(registered => {
  $('webmcp').textContent = registered ? `${tools.length} WebMCP tools available` : 'WebMCP not available in this browser';
});

// Mock mode only: expose the tool executors so headless demos can drive the page without WebMCP.
// The confirmation's Submit button is deliberately not reachable from here.
if (config.mock) {
  (window as unknown as { __scoreboardTools: Record<string, (input?: object) => unknown> }).__scoreboardTools = Object.fromEntries(
    tools.map(tool => [tool.name, (input: object = {}) => tool.execute(input as never)])
  );
}
