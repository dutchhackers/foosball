import { serializable, custom } from 'serializr';
import { serializeFunction, deserializeFunctionIgnoreNull, numberMetric } from '../core/utils/serializers/common.serializer';
import { IPlayer } from '.';
import { FirestoreDocument } from '../core/document.model';

const DEFAULT_AVATAR_URL = 'https://picsum.photos/200?grayscale&blur=2';

export class Player extends FirestoreDocument implements IPlayer {
  @serializable
  id!: string;

  @serializable
  name!: string;

  @serializable
  nickname?: string;

  @serializable(custom(serializeFunction, deserializeFunctionIgnoreNull))
  avatar: string = DEFAULT_AVATAR_URL;

  @serializable
  slackId?: string;

  @serializable
  status?: string;

  @serializable
  quote?: string;

  @serializable
  displayName?: string;

  /**  player stats*/
  @serializable(numberMetric())
  totalMatches = 0;

  @serializable(numberMetric())
  totalWins = 0;

  @serializable(numberMetric())
  totalFlawlessVictories = 0;

  @serializable(numberMetric())
  totalLosses = 0;

  @serializable(numberMetric())
  totalHumiliations = 0;

  @serializable(numberMetric())
  totalSuckerpunches = 0;

  @serializable(numberMetric())
  totalKnockouts = 0;

  @serializable(numberMetric())
  totalGoalsFor = 0;

  @serializable(numberMetric())
  totalGoalsAgainst = 0;

  @serializable
  dateLastMatch?: string;

  @serializable
  dateLastWin?: string;

  @serializable
  dateLastFlawlessVictory?: string;

  @serializable
  dateLastLose?: string;

  @serializable
  dateLastHumiliation?: string;

  @serializable(numberMetric())
  winStreak = 0;

  @serializable(numberMetric())
  highestWinStreak = 0;

  @serializable(numberMetric())
  loseStreak = 0;

  @serializable(numberMetric())
  highestLoseStreak = 0;

  getDisplayName(): string {
    return this.displayName || this.name;
  }

  currentStreakText(): string {
    if (this.winStreak > this.loseStreak) {
      return this.winStreak + ' wins';
    } else if (this.winStreak < this.loseStreak) {
      return this.loseStreak + ' defeats';
    }
    return '';
  }
}
