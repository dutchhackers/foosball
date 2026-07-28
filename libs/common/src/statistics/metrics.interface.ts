import type { FieldValue } from 'firebase-admin/firestore';

export interface IMetrics {
  totalMatches?: number | FieldValue;
  totalWins?: number | FieldValue;
  totalFlawlessVictories?: number | FieldValue;
  totalLosses?: number | FieldValue;
  totalHumiliations?: number | FieldValue;
  totalSuckerpunches?: number | FieldValue;
  totalKnockouts?: number | FieldValue;
  totalGoalsFor?: number | FieldValue;
  totalGoalsAgainst?: number | FieldValue;
  dateLastMatch?: string;
  dateLastWin?: string;
  dateLastFlawlessVictory?: string;
  dateLastLose?: string;
  dateLastHumiliation?: string;

  /** Streaks */
  winStreak?: number | FieldValue;
  loseStreak?: number | FieldValue;
}
