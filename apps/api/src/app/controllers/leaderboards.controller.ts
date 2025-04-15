import express, { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import {
  getTimePeriodIds,
  IPlayer, // Assuming Player class/interface is exported
  ITimeBasedPlayerStats,
  PeriodType,
  PlayerService, // Assuming PlayerService is exported
} from '@foosball/common';

const router = express.Router();
const db = getFirestore(); // Get Firestore instance

// --- Leaderboard Entry Structure ---

/**
 * Represents an entry in the time-based leaderboard for Foosball.
 */
interface FoosballLeaderboardEntry {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  periodId: string; // e.g., "2023-10-27" or "2023-W43"
  periodType: PeriodType;

  // Stats for the period
  matchesPlayed: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number; // Calculated: goalsFor - goalsAgainst
  winPercentage: number; // Calculated: wins / matchesPlayed * 100
  humiliationsInflicted: number;
  humiliationsSuffered: number;
  suckerPunchesDealt: number;
  suckerPunchesReceived: number;
}

// --- Core Leaderboard Logic ---

/**
 * Fetches and ranks players based on their all-time statistics
 * @returns A promise resolving to an array of sorted FoosballLeaderboardEntry objects with all-time stats
 */
async function getAllTimeLeaderboard(): Promise<FoosballLeaderboardEntry[]> {
  const playerService = new PlayerService();
  logger.info('Generating all-time leaderboard');

  try {
    // 1. Get all players
    const allPlayers = await playerService.getPlayers();
    if (!allPlayers || allPlayers.length === 0) {
      logger.warn('No players found.');
      return [];
    }

    // 2. Map players to leaderboard entries using their overall stats
    const leaderboardEntries = allPlayers.map(player => {
      // Get stats directly from player document
      const matchesPlayed = player.totalMatches || 0;
      const wins = player.totalWins || 0;
      const losses = player.totalLosses || 0;
      const goalsFor = player.totalGoalsFor || 0;
      const goalsAgainst = player.totalGoalsAgainst || 0;
      const goalDifference = goalsFor - goalsAgainst;
      // Calculate win percentage carefully to avoid division by zero
      const winPercentage = matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0;

      return {
        playerId: player.id,
        displayName: player.getDisplayName(),
        avatarUrl: player.avatar || null,
        periodId: 'all-time', // Special marker for all-time stats
        periodType: 'all-time' as PeriodType, // Cast to PeriodType for compatibility
        matchesPlayed: matchesPlayed,
        wins: wins,
        losses: losses,
        goalsFor: goalsFor,
        goalsAgainst: goalsAgainst,
        goalDifference: goalDifference,
        winPercentage: winPercentage,
        humiliationsInflicted: player.totalFlawlessVictories || 0,
        humiliationsSuffered: player.totalHumiliations || 0,
        suckerPunchesDealt: player.totalSuckerpunches || 0,
        suckerPunchesReceived: player.totalKnockouts || 0,
      };
    });

    // 3. Filter out players with no matches
    const activeLeaderboardEntries = leaderboardEntries.filter(entry => entry.matchesPlayed > 0);

    // 4. Sort the leaderboard using the same logic as time-based leaderboards
    activeLeaderboardEntries.sort((a, b) => {
      // Primary sort: Wins (descending)
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      // Secondary sort: Win Percentage (descending)
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      // Tertiary sort: Goal Difference (descending)
      if (b.goalDifference !== a.goalDifference) {
        return b.goalDifference - a.goalDifference;
      }
      // Quaternary sort: Matches Played (descending - more activity is better in a tie)
      if (b.matchesPlayed !== a.matchesPlayed) {
        return b.matchesPlayed - a.matchesPlayed;
      }
      // Final sort: Alphabetical by display name (ascending)
      return a.displayName.localeCompare(b.displayName);
    });

    logger.info(`All-time leaderboard generated with ${activeLeaderboardEntries.length} active entries.`);
    return activeLeaderboardEntries;
  } catch (error) {
    logger.error('Error generating all-time leaderboard:', error);
    throw error; // Re-throw to be caught by the route handler
  }
}

/**
 * Fetches and ranks players based on their stats for a specific time period.
 * @param periodType 'daily' or 'weekly'.
 * @param periodId Optional specific period ID (e.g., "2023-10-27" or "2023-W43"). Defaults to current period.
 * @returns A promise resolving to an array of sorted FoosballLeaderboardEntry objects.
 */
async function getTimeBasedLeaderboard(periodType: PeriodType, periodId?: string): Promise<FoosballLeaderboardEntry[]> {
  const playerService = new PlayerService();
  // Use the provided periodId or generate the ID for the current period
  const recordId = periodId || getTimePeriodIds()[periodType];

  logger.info(`Generating ${periodType} leaderboard for period: ${recordId}`);

  try {
    // 1. Get all players (Consider filtering for active players if needed)
    const allPlayers = await playerService.getPlayers(/* { active: true } */); // Add filter if Player model supports 'active'
    if (!allPlayers || allPlayers.length === 0) {
      logger.warn('No players found.');
      return [];
    }

    // 2. Fetch time-based stats for each player for the target period
    const playerStatPromises = allPlayers.map(async player => {
      const statsDocRef = db
        .collection('players')
        .doc(player.id)
        .collection('stats') // Subcollection for stats types
        .doc(periodType) // 'daily' or 'weekly'
        .collection('records') // Subcollection for the actual period data
        .doc(recordId); // Specific day or week ID

      const statsDoc = await statsDocRef.get();
      const periodStats = statsDoc.exists ? (statsDoc.data() as ITimeBasedPlayerStats) : null;

      // Calculate derived stats, handling null/undefined periodStats
      const matchesPlayed = periodStats?.matchesPlayed || 0;
      const wins = periodStats?.wins || 0;
      const losses = periodStats?.losses || 0; // Include losses for calculation
      const goalsFor = periodStats?.goalsFor || 0;
      const goalsAgainst = periodStats?.goalsAgainst || 0;
      const goalDifference = goalsFor - goalsAgainst;
      // Calculate win percentage carefully to avoid division by zero
      const winPercentage = matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0;

      // Return a structure matching FoosballLeaderboardEntry
      return {
        playerId: player.id,
        displayName: player.getDisplayName(), // Use getDisplayName method
        avatarUrl: player.avatar || null, // Assuming 'avatar' field exists
        periodId: recordId,
        periodType: periodType,
        matchesPlayed: matchesPlayed,
        wins: wins,
        losses: losses,
        goalsFor: goalsFor,
        goalsAgainst: goalsAgainst,
        goalDifference: goalDifference,
        winPercentage: winPercentage,
        humiliationsInflicted: periodStats?.humiliationsInflicted || 0,
        humiliationsSuffered: periodStats?.humiliationsSuffered || 0,
        suckerPunchesDealt: periodStats?.suckerPunchesDealt || 0,
        suckerPunchesReceived: periodStats?.suckerPunchesReceived || 0,
      };
    });

    // 3. Resolve all promises
    let leaderboardEntries = await Promise.all(playerStatPromises);

    // 4. Filter out players with no activity in the period
    leaderboardEntries = leaderboardEntries.filter(entry => entry.matchesPlayed > 0);

    // 5. Sort the leaderboard (customize sorting logic as needed)
    leaderboardEntries.sort((a, b) => {
      // Primary sort: Wins (descending)
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      // Secondary sort: Win Percentage (descending)
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      // Tertiary sort: Goal Difference (descending)
      if (b.goalDifference !== a.goalDifference) {
        return b.goalDifference - a.goalDifference;
      }
      // Quaternary sort: Matches Played (descending - more activity is better in a tie)
      if (b.matchesPlayed !== a.matchesPlayed) {
        return b.matchesPlayed - a.matchesPlayed;
      }
      // Final sort: Alphabetical by display name (ascending)
      return a.displayName.localeCompare(b.displayName);
    });

    logger.info(`Leaderboard generated with ${leaderboardEntries.length} active entries.`);
    return leaderboardEntries;
  } catch (error) {
    logger.error(`Error generating ${periodType} leaderboard for ${recordId}:`, error);
    throw error; // Re-throw to be caught by the route handler
  }
}

// --- API Routes ---

// Daily leaderboard endpoint: /leaderboards/day or /leaderboards/day/YYYY-MM-DD
router.get('/day/:dayId?', async (req: Request, res: Response) => {
  const dayId = req.params.dayId; // Optional: YYYY-MM-DD format
  // Basic validation for dayId format if provided
  if (dayId && !/^\d{4}-\d{2}-\d{2}$/.test(dayId)) {
    return res.status(400).json({ error: 'Invalid dayId format. Use YYYY-MM-DD.' });
  }
  logger.debug(`GET /leaderboards/day${dayId ? `/${dayId}` : ''}`);

  try {
    const leaderboard = await getTimeBasedLeaderboard('daily', dayId);
    res.json(leaderboard);
  } catch (error) {
    logger.error('Failed to retrieve daily leaderboard:', error);
    res.status(500).json({ error: 'Failed to retrieve daily leaderboard' });
  }
});

// Weekly leaderboard endpoint: /leaderboards/week or /leaderboards/week/YYYY-WXX
router.get('/week/:weekId?', async (req: Request, res: Response) => {
  const weekId = req.params.weekId; // Optional: YYYY-WXX format
  // Basic validation for weekId format if provided
  if (weekId && !/^\d{4}-W\d{2}$/.test(weekId)) {
    return res.status(400).json({ error: 'Invalid weekId format. Use YYYY-WXX.' });
  }
  logger.debug(`GET /leaderboards/week${weekId ? `/${weekId}` : ''}`);

  try {
    const leaderboard = await getTimeBasedLeaderboard('weekly', weekId);
    res.json(leaderboard);
  } catch (error) {
    logger.error('Failed to retrieve weekly leaderboard:', error);
    res.status(500).json({ error: 'Failed to retrieve weekly leaderboard' });
  }
});

// All-time leaderboard endpoint: /leaderboards/all-time
router.get('/all-time', async (req: Request, res: Response) => {
  logger.debug('GET /leaderboards/all-time');

  try {
    const leaderboard = await getAllTimeLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    logger.error('Failed to retrieve all-time leaderboard:', error);
    res.status(500).json({ error: 'Failed to retrieve all-time leaderboard' });
  }
});

export { router as LeaderboardsController };
