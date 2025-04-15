import { QueryDocumentSnapshot, WriteBatch, getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsOptions, onRequest } from 'firebase-functions/v2/https';

import { IMatchResult } from '@foosball/common';

// --- Configuration ---
const DEFAULT_REGION = 'europe-west1';
const MATCH_FETCH_LIMIT = 500;
const WRITE_BATCH_LIMIT = 450;
const PLAYERS_COLLECTION = 'players';
const MATCHES_COLLECTION = 'matches';
// --- End Configuration ---

// --- Helper Functions ---
interface IPlayerGoalsAggregate {
  totalGoalsFor: number;
  totalGoalsAgainst: number;
  lastMatchDate?: string;
}

function calculatePlayerGoals(playerId: string, matchResult: IMatchResult): { goalsFor: number; goalsAgainst: number } {
  const playerTeamIndex = matchResult.homeTeamIds.includes(playerId) ? 0 : 1;
  const goalsFor = typeof matchResult.finalScore[playerTeamIndex] === 'number' ? matchResult.finalScore[playerTeamIndex] : 0;
  const goalsAgainst =
    typeof matchResult.finalScore[playerTeamIndex === 0 ? 1 : 0] === 'number' ? matchResult.finalScore[playerTeamIndex === 0 ? 1 : 0] : 0;

  return { goalsFor, goalsAgainst };
}

async function writeGoalStatsToFirestore(
  db: FirebaseFirestore.Firestore,
  playerStats: { [playerId: string]: IPlayerGoalsAggregate }
): Promise<number> {
  let currentBatch: WriteBatch = db.batch();
  let batchOpsCount = 0;
  let totalWrites = 0;
  const writePromises: Promise<any>[] = [];

  const commitBatchIfNeeded = async () => {
    if (batchOpsCount > 0) {
      logger.info(`Committing batch with ${batchOpsCount} operations...`);
      writePromises.push(currentBatch.commit());
      totalWrites += batchOpsCount;
      currentBatch = db.batch();
      batchOpsCount = 0;
      await new Promise(resolve => setTimeout(resolve, 100)); // Simple delay
    }
  };

  for (const playerId in playerStats) {
    const stats = playerStats[playerId];
    const docRef = db.collection(PLAYERS_COLLECTION).doc(playerId);

    currentBatch.update(docRef, {
      totalGoalsFor: stats.totalGoalsFor,
      totalGoalsAgainst: stats.totalGoalsAgainst,
      lastMatchDate: stats.lastMatchDate,
    });

    batchOpsCount++;
    if (batchOpsCount >= WRITE_BATCH_LIMIT) {
      await commitBatchIfNeeded();
    }
  }

  await commitBatchIfNeeded(); // Commit final batch
  await Promise.all(writePromises);
  logger.info(`Firestore writes complete. Total documents updated: ${totalWrites}`);
  return totalWrites;
}

// --- Cloud Function Definition ---
const functionOptions: HttpsOptions = {
  region: DEFAULT_REGION,
  timeoutSeconds: 3600, // 60 minutes (max for v2)
  memory: '1GiB',
};

export const backfillGoalsStats = onRequest(functionOptions, async (req, res): Promise<void> => {
  logger.info('Received request to backfill player goals stats.', { query: req.query });

  // --- Security Check ---
  const secret = process.env.BACKFILL_SECRET || 'dev-secret';
  if (req.query.secret !== secret && req.headers['x-backfill-secret'] !== secret) {
    logger.warn('Unauthorized backfill attempt denied.');
    res.status(403).send('Forbidden: Missing or invalid secret.');
    return;
  }

  const db = getFirestore();

  // Determine date range from query parameters or use defaults
  const startDateParam = req.query.startDate as string;
  const endDateParam = req.query.endDate as string;

  // Validate or default dates
  let startDateIso: string;
  let endDateIso: string;
  const now = new Date();
  const defaultStartDate = new Date(2025, 0, 1); // January 1st, 2025

  try {
    startDateIso = startDateParam ? new Date(startDateParam + 'T00:00:00.000Z').toISOString() : defaultStartDate.toISOString();
    endDateIso = endDateParam ? new Date(endDateParam + 'T23:59:59.999Z').toISOString() : now.toISOString();

    if (new Date(endDateIso) < new Date(startDateIso)) {
      throw new Error('End date cannot be before start date.');
    }
  } catch (e) {
    logger.error('Invalid date format provided.', { startDateParam, endDateParam, error: e });
    res.status(400).send(`Invalid date format. Use YYYY-MM-DD. Error: ${e.message}`);
    return;
  }

  logger.info(`Starting goals backfill process for range: ${startDateIso} to ${endDateIso}`);

  // Data structures for aggregation
  const playerStats: { [playerId: string]: IPlayerGoalsAggregate } = {};
  let totalMatchesProcessed = 0;
  let lastMatchSnapshot: QueryDocumentSnapshot | null = null;

  try {
    // Fetch matches in batches
    while (true) {
      let query = db
        .collection(MATCHES_COLLECTION)
        .where('matchDate', '>=', startDateIso)
        .where('matchDate', '<=', endDateIso)
        .orderBy('matchDate', 'asc')
        .limit(MATCH_FETCH_LIMIT);

      if (lastMatchSnapshot) {
        query = query.startAfter(lastMatchSnapshot);
      }

      const matchesSnapshot = await query.get();
      if (matchesSnapshot.empty) {
        logger.info('No more matches found in the date range for this iteration.');
        break;
      }

      const matchesInBatch = matchesSnapshot.docs.length;
      totalMatchesProcessed += matchesInBatch;
      lastMatchSnapshot = matchesSnapshot.docs[matchesInBatch - 1];
      logger.info(`Fetched ${matchesInBatch} matches (Total: ${totalMatchesProcessed}). Aggregating...`);

      // Process Matches
      for (const matchDoc of matchesSnapshot.docs) {
        const matchResult = matchDoc.data() as IMatchResult;
        if (!matchResult.matchDate || !matchResult.homeTeamIds || !matchResult.awayTeamIds || !matchResult.finalScore) {
          logger.warn(`Skipping match ${matchDoc.id} due to missing data.`);
          continue;
        }

        const allPlayerIds: string[] = [...matchResult.homeTeamIds, ...matchResult.awayTeamIds];

        for (const playerId of allPlayerIds) {
          if (!playerStats[playerId]) {
            playerStats[playerId] = {
              totalGoalsFor: 0,
              totalGoalsAgainst: 0,
            };
          }

          const { goalsFor, goalsAgainst } = calculatePlayerGoals(playerId, matchResult);
          playerStats[playerId].totalGoalsFor += goalsFor;
          playerStats[playerId].totalGoalsAgainst += goalsAgainst;

          // Update last match date if this match is more recent
          if (!playerStats[playerId].lastMatchDate || matchResult.matchDate > playerStats[playerId].lastMatchDate) {
            playerStats[playerId].lastMatchDate = matchResult.matchDate;
          }
        }
      }
      logger.info(`Finished aggregating batch. Last match date: ${lastMatchSnapshot?.data().matchDate}`);
    }

    logger.info(`Finished processing all ${totalMatchesProcessed} matches for the range.`);

    // Write aggregated data to Firestore
    logger.info('Starting Firestore writes...');
    const totalWrites = await writeGoalStatsToFirestore(db, playerStats);

    // Send Success Response
    const message = `Goals backfill successful for ${startDateIso} to ${endDateIso}. Processed ${totalMatchesProcessed} matches. Updated ${totalWrites} player documents.`;
    logger.info(message);
    res.status(200).send(message);
  } catch (error: any) {
    logger.error('Goals backfill failed:', error);
    res.status(500).send(`Goals backfill failed: ${error.message}`);
  }
});
