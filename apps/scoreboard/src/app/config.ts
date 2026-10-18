import { ScoreboardPlayer } from './match-state';

/** The api function on the local Firebase emulator (see apps/api/src/main.ts for the region). */
export const EMULATOR_API_BASE = 'http://127.0.0.1:5001/foosball-af8b7/europe-west1/api';

export interface ScoreboardConfig {
  mock: boolean;
  apiBase: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Read `?mock=1` and `?api=` from the page URL. A custom api base is only accepted for a local
 * host, so a crafted link cannot point the scoreboard at some other server.
 */
export function readConfig(search: string): ScoreboardConfig {
  const params = new URLSearchParams(search);
  const mock = params.get('mock') === '1';
  let apiBase = EMULATOR_API_BASE;
  const custom = params.get('api');
  if (custom) {
    try {
      const url = new URL(custom);
      if (LOCAL_HOSTS.has(url.hostname)) {
        apiBase = url.toString().replace(/\/$/, '');
      }
    } catch {
      // ignore invalid URLs and keep the emulator default
    }
  }
  return { mock, apiBase };
}

/** Fictional players for `?mock=1` (demos, screenshots, tests). */
export const MOCK_PLAYERS: ScoreboardPlayer[] = [
  { id: 'ada@example.com', name: 'Ada Lovelace', nickname: 'Ada' },
  { id: 'alan@example.com', name: 'Alan Turing', nickname: 'Alan' },
  { id: 'grace@example.com', name: 'Grace Hopper', nickname: 'Amazing Grace' },
  { id: 'linus@example.com', name: 'Linus Torvalds', nickname: 'Linus' },
  { id: 'margaret@example.com', name: 'Margaret Hamilton', nickname: 'Maggie' },
  { id: 'alan.k@example.com', name: 'Alan Kay', nickname: 'Kay' },
];

export async function fetchPlayers(config: ScoreboardConfig): Promise<ScoreboardPlayer[]> {
  if (config.mock) return MOCK_PLAYERS;
  const response = await fetch(`${config.apiBase}/players`);
  if (!response.ok) {
    throw new Error(`Could not load players (${response.status}).`);
  }
  const players = (await response.json()) as ScoreboardPlayer[];
  return players.map(({ id, name, nickname, displayName, avatar }) => ({ id, name, nickname, displayName, avatar }));
}

/** Same request the API expects for a manual result entry: POST /match-results. */
export async function submitResult(
  config: ScoreboardConfig,
  body: { homeTeamIds: string[]; awayTeamIds: string[]; finalScore: [number, number]; matchDate?: string }
): Promise<'saved' | 'mock'> {
  if (config.mock) return 'mock';
  const response = await fetch(`${config.apiBase}/match-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Saving failed (${response.status}): ${await response.text()}`);
  }
  return 'saved';
}
