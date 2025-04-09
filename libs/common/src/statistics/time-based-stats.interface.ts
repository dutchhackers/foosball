export type PeriodType = 'daily' | 'weekly';

// Interface for the data stored in Firestore for daily/weekly stats
export interface ITimeBasedPlayerStats {
  playerId: string; // Reference back to the player
  timeframeId: string; // e.g., "2023-10-27" or "2023-W43"
  periodType: PeriodType; // 'daily' or 'weekly'

  // Stats for the period
  matchesPlayed: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  humiliationsInflicted: number; // Flawless victories dealt
  humiliationsSuffered: number; // Flawless losses suffered
  suckerPunchesDealt: number; // 11-point wins
  suckerPunchesReceived: number; // 11-point losses

  // Timestamps
  firstActivityAt: string; // ISO timestamp when the first activity of the period occurred
  lastUpdatedAt: string; // ISO timestamp of the last update
}

// Interface for the increments we'll calculate per match
export interface ITimeBasedPlayerStatsIncrements {
  matchesPlayed: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  humiliationsInflicted: number;
  humiliationsSuffered: number;
  suckerPunchesDealt: number;
  suckerPunchesReceived: number;
}
