import { QueryDocumentSnapshot, WriteBatch, getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsOptions, onRequest } from 'firebase-functions/v2/https';

// Adjust the import path based on your project structure/tsconfig
import {
  EntityType,
  IEntityMatchResult,
  IMatchResult,
  ITimeBasedPlayerStats,
  ITimeBasedPlayerStatsIncrements,
  PeriodType,
  checkFlawlessVictory,
  checkSuckerPunch,
  getTimePeriodIds,
} from '@foosball/common'; // Or '@foosball/common/src' etc.

// --- Configuration ---
const DEFAULT_REGION = 'europe-west1'; // Or your preferred region
const MATCH_FETCH_LIMIT = 500;
const WRITE_BATCH_LIMIT = 450;
const PLAYERS_COLLECTION = 'players';
const MATCHES_COLLECTION = 'matches';
// --- End Configuration ---

// --- Helper Functions (Copied from previous script) ---
// NOTE: These are kept internal to the function file for simplicity here.
// Consider moving them back to a shared utility if used elsewhere.

function calculateTimeBasedIncrements(
  entityResult: IEntityMatchResult,
  matchResult: IMatchResult,
  multiplier = 1
): ITimeBasedPlayerStatsIncrements {
  const increments: ITimeBasedPlayerStatsIncrements = {
    matchesPlayed: 1 * multiplier,
    wins: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    humiliationsInflicted: 0,
    humiliationsSuffered: 0,
    suckerPunchesDealt: 0,
    suckerPunchesReceived: 0,
  };
  const playerTeamIndex = matchResult.homeTeamIds.includes(entityResult.entityKey) ? 0 : 1;
  const scoreFor = typeof matchResult.finalScore[playerTeamIndex] === 'number' ? matchResult.finalScore[playerTeamIndex] : 0;
  const scoreAgainst =
    typeof matchResult.finalScore[playerTeamIndex === 0 ? 1 : 0] === 'number' ? matchResult.finalScore[playerTeamIndex === 0 ? 1 : 0] : 0;
  increments.goalsFor = scoreFor * multiplier;
  increments.goalsAgainst = scoreAgainst * multiplier;
  if (entityResult.didWin) {
    increments.wins = 1 * multiplier;
    if (entityResult.hasHumiliation) increments.humiliationsInflicted = 1 * multiplier;
    if (entityResult.hasSuckerPunch) increments.suckerPunchesDealt = 1 * multiplier;
  } else if (entityResult.didLose) {
    increments.losses = 1 * multiplier;
    if (entityResult.hasHumiliation) increments.humiliationsSuffered = 1 * multiplier;
    if (entityResult.hasSuckerPunch) increments.suckerPunchesReceived = 1 * multiplier;
  }
  return increments;
}

function aggregateIncrements(
  existing: Partial<ITimeBasedPlayerStats>,
  increments: ITimeBasedPlayerStatsIncrements,
  matchTimestamp: string
): Partial<ITimeBasedPlayerStats> {
  const firstActivity = existing.firstActivityAt
    ? new Date(existing.firstActivityAt) < new Date(matchTimestamp)
      ? existing.firstActivityAt
      : matchTimestamp
    : matchTimestamp;
  return {
    matchesPlayed: (existing.matchesPlayed || 0) + increments.matchesPlayed,
    wins: (existing.wins || 0) + increments.wins,
    losses: (existing.losses || 0) + increments.losses,
    goalsFor: (existing.goalsFor || 0) + increments.goalsFor,
    goalsAgainst: (existing.goalsAgainst || 0) + increments.goalsAgainst,
    humiliationsInflicted: (existing.humiliationsInflicted || 0) + increments.humiliationsInflicted,
    humiliationsSuffered: (existing.humiliationsSuffered || 0) + increments.humiliationsSuffered,
    suckerPunchesDealt: (existing.suckerPunchesDealt || 0) + increments.suckerPunchesDealt,
    suckerPunchesReceived: (existing.suckerPunchesReceived || 0) + increments.suckerPunchesReceived,
    firstActivityAt: firstActivity,
    lastUpdatedAt: matchTimestamp > (existing.lastUpdatedAt || '') ? matchTimestamp : existing.lastUpdatedAt,
  };
}

async function writeAggregatesToFirestore(
  db: FirebaseFirestore.Firestore,
  aggregates: { [timeframeId: string]: { [playerId: string]: Partial<ITimeBasedPlayerStats> } },
  periodType: PeriodType,
  nowISOforFallback: string
): Promise<number> {
  // Return total writes
  let currentBatch: WriteBatch = db.batch();
  let batchOpsCount = 0;
  let totalWrites = 0;
  const writePromises: Promise<any>[] = [];

  const commitBatchIfNeeded = async () => {
    if (batchOpsCount > 0) {
      logger.info(`Committing ${periodType} batch with ${batchOpsCount} operations...`);
      writePromises.push(currentBatch.commit());
      totalWrites += batchOpsCount;
      currentBatch = db.batch(); // Start a new batch
      batchOpsCount = 0;
      await new Promise(resolve => setTimeout(resolve, 100)); // Simple delay
    }
  };

  for (const timeframeId in aggregates) {
    for (const playerId in aggregates[timeframeId]) {
      const statsData = aggregates[timeframeId][playerId];
      const docRef = db
        .collection(PLAYERS_COLLECTION)
        .doc(playerId)
        .collection('stats')
        .doc(periodType)
        .collection('records')
        .doc(timeframeId);
      const finalDoc: ITimeBasedPlayerStats = {
        playerId,
        timeframeId,
        periodType,
        matchesPlayed: statsData.matchesPlayed || 0,
        wins: statsData.wins || 0,
        losses: statsData.losses || 0,
        goalsFor: statsData.goalsFor || 0,
        goalsAgainst: statsData.goalsAgainst || 0,
        humiliationsInflicted: statsData.humiliationsInflicted || 0,
        humiliationsSuffered: statsData.humiliationsSuffered || 0,
        suckerPunchesDealt: statsData.suckerPunchesDealt || 0,
        suckerPunchesReceived: statsData.suckerPunchesReceived || 0,
        firstActivityAt: statsData.firstActivityAt || nowISOforFallback,
        lastUpdatedAt: statsData.lastUpdatedAt || nowISOforFallback,
      };
      currentBatch.set(docRef, finalDoc);
      batchOpsCount++;
      if (batchOpsCount >= WRITE_BATCH_LIMIT) {
        await commitBatchIfNeeded();
      }
    }
  }
  await commitBatchIfNeeded(); // Commit final batch
  await Promise.all(writePromises);
  logger.info(`Firestore writes complete for ${periodType}. Total documents written/updated: ${totalWrites}`);
  return totalWrites; // Return count
}

// --- Cloud Function Definition ---

// Set function options - increase timeout significantly!
const functionOptions: HttpsOptions = {
  region: DEFAULT_REGION,
  timeoutSeconds: 3600, // 60 minutes (max for v2) - adjust if needed
  memory: '1GiB', // Increase memory if aggregation is large
  // concurrency: 1,       // Optional: Limit to one concurrent execution if needed
};

export const backfillTimeStats = onRequest(functionOptions, async (req, res): Promise<void> => {
  logger.info('Received request to backfill time-based stats.', { query: req.query });

  // --- Security Check (IMPORTANT!) ---
  // This endpoint is public by default. Add security checks for production.
  // Example: Check for a specific secret header or query parameter.
  const secret = process.env.BACKFILL_SECRET || 'dev-secret'; // Use runtime env var or fallback
  if (req.query.secret !== secret && req.headers['x-backfill-secret'] !== secret) {
    logger.warn('Unauthorized backfill attempt denied.');
    res.status(403).send('Forbidden: Missing or invalid secret.');
    return;
  }
  // --- End Security Check ---

  const db = getFirestore(); // Get Firestore instance

  // Determine date range from query parameters or use defaults
  const startDateParam = req.query.startDate as string; // e.g., YYYY-MM-DD
  const endDateParam = req.query.endDate as string; // e.g., YYYY-MM-DD

  // Validate or default dates
  let startDateIso: string;
  let endDateIso: string;
  const now = new Date();
  const defaultStartDate = new Date(2025, 0, 1); // January 1st, 2025

  try {
    startDateIso = startDateParam
      ? new Date(startDateParam + 'T00:00:00.000Z').toISOString() // Assume start of day UTC
      : defaultStartDate.toISOString();
    // Ensure end date includes the full day
    endDateIso = endDateParam
      ? new Date(endDateParam + 'T23:59:59.999Z').toISOString() // Assume end of day UTC
      : now.toISOString();

    // Basic validation: end date should not be before start date
    if (new Date(endDateIso) < new Date(startDateIso)) {
      throw new Error('End date cannot be before start date.');
    }
  } catch (e) {
    logger.error('Invalid date format provided.', { startDateParam, endDateParam, error: e });
    res.status(400).send(`Invalid date format. Use YYYY-MM-DD. Error: ${e.message}`);
    return;
  }

  logger.info(`Starting backfill process for range: ${startDateIso} to ${endDateIso}`);

  // Data structures for aggregation
  const dailyAggregates: { [timeframeId: string]: { [playerId: string]: Partial<ITimeBasedPlayerStats> } } = {};
  const weeklyAggregates: { [timeframeId: string]: { [playerId: string]: Partial<ITimeBasedPlayerStats> } } = {};
  let totalMatchesProcessed = 0;
  let lastMatchSnapshot: QueryDocumentSnapshot | null = null;

  try {
    // Fetch matches in batches
    // eslint-disable-next-line no-constant-condition
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

      // --- Process Matches (Copied logic) ---
      for (const matchDoc of matchesSnapshot.docs) {
        const matchResult = matchDoc.data() as IMatchResult;
        if (!matchResult.matchDate || !matchResult.homeTeamIds || !matchResult.awayTeamIds || !matchResult.finalScore) {
          logger.warn(`Skipping match ${matchDoc.id} due to missing data.`);
          continue;
        }
        const matchTimestamp = matchResult.matchDate;
        const timePeriodIds = getTimePeriodIds(matchTimestamp);
        const allPlayerIds: string[] = [...matchResult.homeTeamIds, ...matchResult.awayTeamIds];
        const winners: string[] = matchResult.toto === 1 ? matchResult.homeTeamIds : matchResult.toto === 2 ? matchResult.awayTeamIds : [];
        const losers: string[] = matchResult.toto === 1 ? matchResult.awayTeamIds : matchResult.toto === 2 ? matchResult.homeTeamIds : [];
        const flags = {
          hasHumiliation: checkFlawlessVictory(matchResult.finalScore),
          hasSuckerPunch: checkSuckerPunch(matchResult.finalScore),
        };

        for (const playerId of allPlayerIds) {
          const entityMatchResult: IEntityMatchResult = {
            matchDate: matchTimestamp,
            entityType: EntityType.PLAYER,
            entityKey: playerId,
            didWin: winners.includes(playerId),
            didLose: losers.includes(playerId),
            hasHumiliation: flags.hasHumiliation,
            hasSuckerPunch: flags.hasSuckerPunch,
          };
          const increments = calculateTimeBasedIncrements(entityMatchResult, matchResult);
          if (!dailyAggregates[timePeriodIds.daily]) dailyAggregates[timePeriodIds.daily] = {};
          dailyAggregates[timePeriodIds.daily][playerId] = aggregateIncrements(
            dailyAggregates[timePeriodIds.daily][playerId] || {},
            increments,
            matchTimestamp
          );
          if (!weeklyAggregates[timePeriodIds.weekly]) weeklyAggregates[timePeriodIds.weekly] = {};
          weeklyAggregates[timePeriodIds.weekly][playerId] = aggregateIncrements(
            weeklyAggregates[timePeriodIds.weekly][playerId] || {},
            increments,
            matchTimestamp
          );
        }
      }
      logger.info(`Finished aggregating batch. Last match date: ${lastMatchSnapshot?.data().matchDate}`);
      // --- Check if timeout is approaching ---
      // This is a simple check; more sophisticated checks might be needed
      // const elapsed = Date.now() - context.rawRequest.timestamp; // Requires context access if using onCall
      // if (elapsed > (functionOptions.timeoutSeconds - 30) * 1000) {
      //     logger.warn("Approaching timeout, stopping early.");
      //     // Implement state saving and continuation logic here if needed (Option B)
      //     res.status(504).send("Timeout likely, processed partial data.");
      //     return;
      // }
    } // End while loop

    logger.info(`Finished processing all ${totalMatchesProcessed} matches for the range.`);

    // --- Write aggregated data to Firestore ---
    logger.info('Starting Firestore writes...');
    const dailyWrites = await writeAggregatesToFirestore(db, dailyAggregates, 'daily', now.toISOString());
    const weeklyWrites = await writeAggregatesToFirestore(db, weeklyAggregates, 'weekly', now.toISOString());

    // --- Send Success Response ---
    const message = `Backfill successful for ${startDateIso} to ${endDateIso}. Processed ${totalMatchesProcessed} matches. Updated/created ${dailyWrites} daily and ${weeklyWrites} weekly stats documents.`;
    logger.info(message);
    res.status(200).send(message);
  } catch (error: any) {
    logger.error('Backfill failed:', error);
    res.status(500).send(`Backfill failed: ${error.message}`);
  }
});
