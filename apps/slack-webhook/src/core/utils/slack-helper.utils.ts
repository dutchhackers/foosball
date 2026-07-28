import type { Firestore } from 'firebase-admin/firestore';
import { IOption, MatchService, Player, PlayerService } from '@foosball/common';
import { IFinalScore, IPlayer } from '@foosball/common';
import { Response } from 'express';
import { deserialize } from 'serializr';

type OptionsValue = 'players' | '_dummy';

interface IDefaultLeaderboardOpts {
  minDateLastMatch?: string;
}

export class SlackHelper {
  static async acknowledge(res?: Response | any, body?: any) {
    if (!res) {
      return;
    }

    console.log('Slack Helper Acknowledge');
    return this.send(res, body);
  }

  static async send(res: Response, body?: any): Promise<Response> {
    return res.status(200).send(body);
  }

  static async getExternalDataOptions(playerService: PlayerService, name: OptionsValue): Promise<IOption[]> {
    switch (name) {
      case 'players':
        return this.getPlayersDataOptions(playerService);
    }
    return [];
  }

  static concatPlayersString(ids: string[], players: IPlayer[]): string {
    return ids.reduce((str, id, i) => {
      const player = players.find(p => p.id == id);
      if (!player) return str;
      if (i === 0) return str + player.name;
      if (i === ids.length - 1) return str + ` and ${player.name}`;
      return str + `, ${player.name}`;
    }, '');
  }

  static buildMatchResultString(home: string, away: string, score: IFinalScore): string {
    const words = ['slayed', 'rekt', 'defeated', 'crushed', ':rekt:', 'annihilated', 'vanquished'];

    if (score[0] > score[1] && score[0] === 11) {
      return `${home} suckerpunched ${away}, with a score of: ${score[0]} - ${score[1]}`;
    } else if (score[1] > score[0] && score[1] === 11) {
      return `${away} suckerpunched ${home}, with a score of: ${score[1]} - ${score[0]}`;
    }

    return score[0] > score[1]
      ? `${home} ${words[Math.round(Math.random() * words.length)]} ${away}, with a score of: ${score[0]} - ${score[1]}`
      : `${away} ${words[Math.round(Math.random() * words.length)]} ${home}, with a score of: ${score[1]} - ${score[0]}`;
  }

  static buildUpdateProfileString(player: Player): string {
    return `Successfully updated your profile ${player.getDisplayName()}!`;
  }

  static async getDefaultLeaderboard(db: Firestore, options: IDefaultLeaderboardOpts = {}): Promise<any> {
    const query = db.collection('players').where('totalHumiliations', '>=', 0);
    const snapshot = await query.orderBy('totalHumiliations', 'desc').get();
    const snapshotData = snapshot.docs.map(p => deserialize<Player>(Player, p.data()));
    const filteredData = snapshotData; //applyFilter(snapshotData, options);

    let count = 0;
    const items = [];
    for (const player of filteredData) {
      count++;
      items.push({
        rank: count,
        title: player.getDisplayName(),
        score: player.totalHumiliations,
        wins: player.totalWins,
        losses: player.totalLosses,
        streakText: player.currentStreakText(),
      });
    }

    return {
      name: 'Kroepn',
      ranking: items,
    };
  }

  static async getFoosballStats(matchService: MatchService): Promise<any> {
    const matches = await matchService.getMatches({ limit: 5 });

    const metrics: any = {
      MATCH_COUNT_CURR_WK: 0,
    };

    metrics.MATCH_COUNT_CURR_WK = matches.length;

    /*
      - # this week
      - aantal potjes
      - max win streak
      - max lose streak
      - current streaks
      - win/lose delta
      - humiliated

      - # all time
      - max kroepen
      - max fatalities
      - max win streak
      - max lose streak
      - nooit gekropen
      - max given suckerpunches
      - max received suckerpunches
    */
  }

  private static async getPlayersDataOptions(playerService: PlayerService): Promise<IOption[]> {
    // const playerService = new PlayerService(db);
    const players = await playerService.getPlayers();

    return players.map(p => {
      return {
        label: p.name,
        value: p.id,
      };
    });
  }
}

function applyFilter(items: Player[], filter: IDefaultLeaderboardOpts): Player[] {
  if (!items) {
    return [];
  }
  let result = [...items];

  if (filter.minDateLastMatch) {
    result = result.filter(p => p.dateLastMatch && filter.minDateLastMatch && p.dateLastMatch >= filter.minDateLastMatch);
  }

  return result;
}
