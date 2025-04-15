/**  player stats*/
export interface IPlayerStats {
  totalMatches?: number;
  totalWins?: number;
  totalFlawlessVictories?: number;
  totalLosses?: number;
  totalHumiliations?: number;
  totalSuckerpunches?: number;
  totalKnockouts?: number;
  totalGoalsFor?: number;
  totalGoalsAgainst?: number;
  dateLastMatch?: string;
  dateLastWin?: string;
  dateLastFlawlessVictory?: string;
  dateLastLose?: string;
  dateLastHumiliation?: string;
  winStreak?: number;
  highestWinStreak?: number;
  loseStreak?: number;
  highestLoseStreak?: number;
}

export interface IPlayer extends IPlayerStats {
  id: string;
  name: string;
  nickname?: string;
  avatar: string;
  slackId?: string;
  status?: string;
  quote?: string;
  displayName?: string;
  getDisplayName(): string;
}
