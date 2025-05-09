import { FieldValue, Transaction, FieldPath, DocumentSnapshot, DocumentReference } from 'firebase-admin/firestore'; // Import DocumentReference
import { CoreService } from '../core/abstract-service';
import { IMatchResult } from '../match/match-result.model';
import { checkFlawlessVictory, checkSuckerPunch, getTimePeriodIds } from '../core/utils';
import { Collection } from '../core/utils/firestore-db';
import { IMetrics } from './metrics.interface';
import { IEntityMatchResult } from './statistics.interface';
import { EntityType } from './statistics.enum';
import { ITimeBasedPlayerStats, ITimeBasedPlayerStatsIncrements, PeriodType } from './time-based-stats.interface';
import { IPlayerStats } from '../player/player.interface';

const PLAYERS_COLLECTION = Collection.PLAYERS;

export interface IStatsService {
  generateStats(transaction: Transaction, matchResult: IMatchResult, opts?: { multiplier?: number }): Promise<void>;
  batchUpdateStreaks(playerIds: string[]): Promise<void>;
}

export class StatsService extends CoreService implements IStatsService {
  constructor() {
    super();
  }

  async generateStats(transaction: Transaction, matchResult: IMatchResult, opts: { multiplier?: number } = {}): Promise<void> {
    const allPlayerIds: string[] = [...matchResult.homeTeamIds, ...matchResult.awayTeamIds];
    const winners: string[] = [];
    const losers: string[] = [];
    const multiplier = opts.multiplier || 1;

    if (matchResult.toto === 1) {
      winners.push(...matchResult.homeTeamIds);
      losers.push(...matchResult.awayTeamIds);
    } else if (matchResult.toto === 2) {
      winners.push(...matchResult.awayTeamIds);
      losers.push(...matchResult.homeTeamIds);
    }

    const flags = {
      hasHumiliation: checkFlawlessVictory(matchResult.finalScore),
      hasSuckerPunch: checkSuckerPunch(matchResult.finalScore),
    };

    const nowISO = new Date().toISOString();
    const timePeriodIds = getTimePeriodIds(matchResult.matchDate || nowISO);

    // --- Read Phase: Gather all references and read them ---
    const refsToRead: DocumentReference[] = [];
    const refMap = new Map<string, { playerRef: DocumentReference; dailyRef: DocumentReference; weeklyRef: DocumentReference }>();

    for (const playerId of allPlayerIds) {
      const playerRef = this.db.collection(PLAYERS_COLLECTION).doc(playerId);
      const dailyStatsRef = this.db
        .collection(PLAYERS_COLLECTION)
        .doc(playerId)
        .collection('stats')
        .doc('daily')
        .collection('records')
        .doc(timePeriodIds.daily);
      const weeklyStatsRef = this.db
        .collection(PLAYERS_COLLECTION)
        .doc(playerId)
        .collection('stats')
        .doc('weekly')
        .collection('records')
        .doc(timePeriodIds.weekly);

      refsToRead.push(dailyStatsRef, weeklyStatsRef); // Add refs for time-based docs
      // Optionally add playerRef if needed for reads: refsToRead.push(playerRef);
      refMap.set(playerId, { playerRef, dailyRef: dailyStatsRef, weeklyRef: weeklyStatsRef });
    }

    // Execute all reads upfront
    const allSnapshots = await transaction.getAll(...refsToRead);

    // Create maps for easy lookup of snapshots by their original reference path
    const snapshotMap = new Map<string, DocumentSnapshot>();
    allSnapshots.forEach(snap => snapshotMap.set(snap.ref.path, snap));
    // --- End Read Phase ---

    // --- Write Phase: Process each player using the read data ---
    for (const playerId of allPlayerIds) {
      const refs = refMap.get(playerId);
      if (!refs) continue; // Should not happen

      // Retrieve the snapshots for this player from the map
      const dailySnapshot = snapshotMap.get(refs.dailyRef.path);
      const weeklySnapshot = snapshotMap.get(refs.weeklyRef.path);
      // const playerSnapshot = snapshotMap.get(refs.playerRef.path); // Retrieve if playerRef was read

      if (!dailySnapshot || !weeklySnapshot) {
        console.error(
          `Snapshot missing for player ${playerId} refs. Path daily: ${refs.dailyRef.path}, Path weekly: ${refs.weeklyRef.path}. This indicates an issue with getAll or map lookup.`
        );
        // Decide how to handle: skip player? throw error?
        continue; // Skip this player if snapshots are missing
      }

      const entityMatchResult: IEntityMatchResult = {
        matchDate: matchResult.matchDate || nowISO,
        entityType: EntityType.PLAYER,
        entityKey: playerId,
        didWin: winners.includes(playerId),
        didLose: losers.includes(playerId),
        hasHumiliation: flags.hasHumiliation,
        hasSuckerPunch: flags.hasSuckerPunch,
      };

      // Calculate increments
      const playerStatsIncrements = this.calculateMetrics(entityMatchResult, matchResult, multiplier); // Pass matchResult
      const timeBasedIncrements = this.calculateTimeBasedIncrements(entityMatchResult, matchResult, multiplier);

      // Perform writes using the transaction

      // 1. Write Main Player Stats
      const updateData = { ...playerStatsIncrements, modificationDate: nowISO };
      transaction.set(refs.playerRef, updateData, { merge: true });

      // 2. Write Daily Stats (pass ref and the snapshot read earlier)
      this.updateTimeBasedStatsDoc(
        transaction,
        refs.dailyRef, // Pass ref for writing
        dailySnapshot, // Pass the read snapshot
        playerId,
        timePeriodIds.daily,
        'daily',
        timeBasedIncrements,
        nowISO
      );

      // 3. Write Weekly Stats (pass ref and the snapshot read earlier)
      this.updateTimeBasedStatsDoc(
        transaction,
        refs.weeklyRef, // Pass ref for writing
        weeklySnapshot, // Pass the read snapshot
        playerId,
        timePeriodIds.weekly,
        'weekly',
        timeBasedIncrements,
        nowISO
      );
    }
    // --- End Write Phase ---
  }

  // batchUpdateStreaks remains the same as the previous version
  public async batchUpdateStreaks(playerIds: string[]): Promise<void> {
    if (!playerIds || playerIds.length === 0) {
      return;
    }

    const batch = this.db.batch();
    let maxStreakChanged = false;

    const playerRefs = playerIds.map(id => this.db.collection(PLAYERS_COLLECTION).doc(id));
    const playerSnapshots = await this.db.getAll(...playerRefs);

    for (const snapshot of playerSnapshots) {
      if (!snapshot.exists) continue;

      const data = snapshot.data()!;
      const docRef = snapshot.ref;

      const currentWinStreak = data.winStreak || 0;
      const highestWinStreak = data.highestWinStreak || 0;
      const currentLoseStreak = data.loseStreak || 0;
      const highestLoseStreak = data.highestLoseStreak || 0;

      let needsUpdate = false;
      const updatePayload: Partial<IPlayerStats> = {};

      if (currentWinStreak > highestWinStreak) {
        maxStreakChanged = true;
        needsUpdate = true;
        updatePayload.highestWinStreak = currentWinStreak;
      }

      if (currentLoseStreak > highestLoseStreak) {
        maxStreakChanged = true;
        needsUpdate = true;
        updatePayload.highestLoseStreak = currentLoseStreak;
      }

      if (needsUpdate) {
        batch.set(docRef, updatePayload, { merge: true });
      }
    }

    if (maxStreakChanged) {
      try {
        await batch.commit();
        console.log(`Streaks updated for relevant players among: ${playerIds.join(', ')}.`);
      } catch (error) {
        console.error('Failed to commit streak updates batch:', error);
      }
    }
  }

  // calculateMetrics updated to include goals
  private calculateMetrics(entityResult: IEntityMatchResult, matchResult: IMatchResult, multiplier: number): IMetrics {
    const metrics: IMetrics = {};
    const now = new Date().toISOString();

    // Determine goals for and against for this player
    const playerTeamIndex = matchResult.homeTeamIds.includes(entityResult.entityKey) ? 0 : 1;
    const goalsFor = typeof matchResult.finalScore[playerTeamIndex] === 'number' ? matchResult.finalScore[playerTeamIndex] : 0;
    const goalsAgainst =
      typeof matchResult.finalScore[playerTeamIndex === 0 ? 1 : 0] === 'number' ? matchResult.finalScore[playerTeamIndex === 0 ? 1 : 0] : 0;

    metrics.totalMatches = FieldValue.increment(multiplier * 1);
    metrics.totalGoalsFor = FieldValue.increment(goalsFor * multiplier);
    metrics.totalGoalsAgainst = FieldValue.increment(goalsAgainst * multiplier);
    metrics.dateLastMatch = now;

    if (entityResult.didWin) {
      metrics.totalWins = FieldValue.increment(multiplier * 1);
      metrics.dateLastWin = now;
      metrics.winStreak = FieldValue.increment(multiplier * 1);
      metrics.loseStreak = 0;

      if (entityResult.hasHumiliation) {
        metrics.totalFlawlessVictories = FieldValue.increment(multiplier * 1);
        metrics.dateLastFlawlessVictory = now;
      }
      if (entityResult.hasSuckerPunch) {
        metrics.totalSuckerpunches = FieldValue.increment(multiplier * 1);
      }
    } else if (entityResult.didLose) {
      metrics.totalLosses = FieldValue.increment(multiplier * 1);
      metrics.dateLastLose = now;
      metrics.loseStreak = FieldValue.increment(multiplier * 1);
      metrics.winStreak = 0;

      if (entityResult.hasHumiliation) {
        metrics.totalHumiliations = FieldValue.increment(multiplier * 1);
        metrics.dateLastHumiliation = now;
      }
      if (entityResult.hasSuckerPunch) {
        metrics.totalKnockouts = FieldValue.increment(multiplier * 1);
      }
    } else {
      metrics.winStreak = 0;
      metrics.loseStreak = 0;
    }

    return metrics;
  }

  // calculateTimeBasedIncrements remains the same as the previous version
  private calculateTimeBasedIncrements(
    entityResult: IEntityMatchResult,
    matchResult: IMatchResult,
    multiplier: number
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

  // updateTimeBasedStatsDoc remains the same as the previous version (accepts snapshot)
  private updateTimeBasedStatsDoc(
    transaction: Transaction,
    statsDocRef: FirebaseFirestore.DocumentReference,
    statsDocSnapshot: DocumentSnapshot,
    playerId: string,
    timeframeId: string,
    periodType: PeriodType,
    increments: ITimeBasedPlayerStatsIncrements,
    timestamp: string
  ): void {
    if (statsDocSnapshot.exists) {
      // Read existing data, add increments, and set the document
      const existingStats = statsDocSnapshot.data() as ITimeBasedPlayerStats;
      const updatedStats: ITimeBasedPlayerStats = {
        ...existingStats,
        matchesPlayed: (existingStats.matchesPlayed || 0) + increments.matchesPlayed,
        wins: (existingStats.wins || 0) + increments.wins,
        losses: (existingStats.losses || 0) + increments.losses,
        goalsFor: (existingStats.goalsFor || 0) + increments.goalsFor,
        goalsAgainst: (existingStats.goalsAgainst || 0) + increments.goalsAgainst,
        humiliationsInflicted: (existingStats.humiliationsInflicted || 0) + increments.humiliationsInflicted,
        humiliationsSuffered: (existingStats.humiliationsSuffered || 0) + increments.humiliationsSuffered,
        suckerPunchesDealt: (existingStats.suckerPunchesDealt || 0) + increments.suckerPunchesDealt,
        suckerPunchesReceived: (existingStats.suckerPunchesReceived || 0) + increments.suckerPunchesReceived,
        lastUpdatedAt: timestamp, // Always update lastUpdatedAt
        // firstActivityAt should only be set on initial creation, so we don't update it here
      };
      transaction.set(statsDocRef, updatedStats); // Use set instead of update with increment
    } else {
      // Document doesn't exist, create it with the increments
      const newStatsDoc: ITimeBasedPlayerStats = {
        playerId: playerId,
        timeframeId: timeframeId,
        periodType: periodType,
        matchesPlayed: increments.matchesPlayed,
        wins: increments.wins,
        losses: increments.losses,
        goalsFor: increments.goalsFor,
        goalsAgainst: increments.goalsAgainst,
        humiliationsInflicted: increments.humiliationsInflicted,
        humiliationsSuffered: increments.humiliationsSuffered,
        suckerPunchesDealt: increments.suckerPunchesDealt,
        suckerPunchesReceived: increments.suckerPunchesReceived,
        firstActivityAt: timestamp,
        lastUpdatedAt: timestamp,
      };
      transaction.set(statsDocRef, newStatsDoc);
    }
  }
}
