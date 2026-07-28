import type { Firestore } from 'firebase-admin/firestore';
import { connectFirestore, IMatchResult, IPlayerStats, PlayerService, StatsUtils } from '@foosball/common';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';

const DEFAULT_REGION = 'europe-west1';
setGlobalOptions({ region: DEFAULT_REGION });

interface SyncPlayerStatsRequest {
  playerId: string;
}

interface ResponseObject<T> {
  success: boolean;
  data?: T;
}

export const syncPlayerStats = onRequest(async (req, res) => {
  const stats: SyncPlayerStatsRequest = req.body;
  logger.info('Sync player stats', { playerId: stats.playerId });

  const updatedPlayerStats = await execSyncPlayerStats(stats.playerId);

  const response: ResponseObject<IPlayerStats | undefined> = {
    success: !!updatedPlayerStats,
    data: updatedPlayerStats,
  };

  res.status(updatedPlayerStats ? 200 : 404).json(response);
});

function getDefaultStartDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString();
}

async function getPlayerMatches(
  playerId: string,
  db: Firestore,
  options?: {
    maxSize?: number;
    startDate?: string;
  }
) {
  const { maxSize = 1000, startDate = getDefaultStartDate() } = options || {};

  const query = db
    .collection('matches')
    .where('_members', 'array-contains', playerId)
    .orderBy('matchDate', 'asc')
    .where('matchDate', '>=', startDate)
    .limit(maxSize);

  return query.get();
}

async function execSyncPlayerStats(playerId: string): Promise<IPlayerStats | undefined> {
  const db = connectFirestore();
  const playerService = new PlayerService();
  const player = await playerService.getPlayer(playerId);

  if (!player) {
    logger.info('Player not found, skipping stats calculation', { playerId });
    return undefined;
  }

  logger.info('Player found', { player });
  const matches = await getPlayerMatches(playerId, db, { maxSize: 1000 });

  logger.info('Found matches', { count: matches.size });

  const playerStats = initializePlayerStats();

  matches.forEach(matchSnapshot => {
    const match = matchSnapshot.data() as IMatchResult;
    const entityMatchResult = StatsUtils.calculatePlayerMatchResult(playerId, match);

    StatsUtils.calculateUpdatedPlayerStats(playerStats, entityMatchResult);
  });

  // update player stats
  await playerService.updatePlayerStats(playerId, playerStats);

  return playerStats;
}

function initializePlayerStats(): IPlayerStats {
  return {
    totalMatches: 0,
    totalWins: 0,
    totalFlawlessVictories: 0,
    totalLosses: 0,
    totalHumiliations: 0,
    totalSuckerpunches: 0,
    totalKnockouts: 0,
    dateLastMatch: null,
    dateLastWin: null,
    dateLastFlawlessVictory: null,
    dateLastLose: null,
    dateLastHumiliation: null,
    winStreak: 0,
    highestWinStreak: 0,
    loseStreak: 0,
    highestLoseStreak: 0,
  };
}
