import * as admin from 'firebase-admin';

export interface IMetrics {
  totalMatches?: number | admin.firestore.FieldValue;
  totalWins?: number | admin.firestore.FieldValue;
  totalFlawlessVictories?: number | admin.firestore.FieldValue;
  totalLosses?: number | admin.firestore.FieldValue;
  totalHumiliations?: number | admin.firestore.FieldValue;
  totalSuckerpunches?: number | admin.firestore.FieldValue;
  totalKnockouts?: number | admin.firestore.FieldValue;
  totalGoalsFor?: number | admin.firestore.FieldValue;
  totalGoalsAgainst?: number | admin.firestore.FieldValue;
  dateLastMatch?: string;
  dateLastWin?: string;
  dateLastFlawlessVictory?: string;
  dateLastLose?: string;
  dateLastHumiliation?: string;

  /** Streaks */
  winStreak?: number | admin.firestore.FieldValue;
  loseStreak?: number | admin.firestore.FieldValue;
}
