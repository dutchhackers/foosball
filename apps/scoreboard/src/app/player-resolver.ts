import { ScoreboardPlayer } from './match-state';

export class PlayerResolutionError extends Error {}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function labels(player: ScoreboardPlayer): string[] {
  return [player.id, player.name, player.nickname, player.displayName].filter((v): v is string => !!v).map(normalize);
}

export function playerLabel(player: ScoreboardPlayer): string {
  return player.displayName || player.nickname || player.name;
}

/**
 * Resolve a spoken name against the known players.
 * 1. exact match on id, name, nickname or displayName (case and accent insensitive);
 * 2. otherwise a unique word-prefix match ("jan" -> "Jan de Vries").
 * Ambiguity or no match throws, listing candidates so the agent can ask the user.
 */
export function resolvePlayer(query: string, players: ScoreboardPlayer[]): ScoreboardPlayer {
  const q = normalize(query);
  if (!q) {
    throw new PlayerResolutionError('Empty player name.');
  }

  const exact = players.filter(p => labels(p).includes(q));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new PlayerResolutionError(`"${query}" is ambiguous: ${exact.map(playerLabel).join(', ')}. Ask which one.`);
  }

  const prefix = players.filter(p =>
    labels(p).some(label => label.split(/[\s.@_-]+/).some(word => word.startsWith(q)) || label.startsWith(q))
  );
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    const names = prefix.slice(0, 5).map(playerLabel).join(', ');
    throw new PlayerResolutionError(`"${query}" matches several players: ${names}. Ask which one.`);
  }
  throw new PlayerResolutionError(`No known player matches "${query}".`);
}

/** Resolve both teams; collects every problem so a single error lists them all. */
export function resolveTeams(
  red: string[],
  blue: string[],
  players: ScoreboardPlayer[]
): { red: ScoreboardPlayer[]; blue: ScoreboardPlayer[] } {
  const errors: string[] = [];
  const resolve = (names: string[]) =>
    names.flatMap(name => {
      try {
        return [resolvePlayer(name, players)];
      } catch (e) {
        errors.push((e as Error).message);
        return [];
      }
    });
  const result = { red: resolve(red), blue: resolve(blue) };
  if (errors.length) {
    throw new PlayerResolutionError(errors.join(' '));
  }
  return result;
}
