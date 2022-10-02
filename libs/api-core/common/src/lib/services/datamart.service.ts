import { Injectable } from '@nestjs/common';

// import * as _ from 'lodash';
import { IMatchResult, MatchResult } from '../models/match-result';
import { MatchService } from './match.service';
import { CoreService } from './abstract-service';
// import moment = require('moment');
import { checkFlawlessVictory } from '../utils';
// import { ICubeItem } from '../models/cube-item';
import { MatchServiceHelper } from './match-service-helper';
// import { IMatchCubeItem } from '../models/match-cube-item';
import { DataService } from '@foosball/api/data';
import { ICubeItem, IMatchCubeItem } from '@foosball/dto';

const MATCHES_BY_PLAYER_COLLECTION = 'data/cubes';

interface ICubeFilterOpts {
  from?: string;
  to?: string;
  limit: number;
  player?: string;
  order: 'asc' | 'desc';
}

@Injectable()
export class DataMartService extends CoreService {
  private _matchService: MatchService;
  private _matchData: IMatchResult[] = [];

  constructor(private readonly data: DataService, private readonly matchService: MatchService) {
    super(data);

    this._matchService = matchService;
  }

  async loadMatchData(opts: { from: string; to: string; limit: number }) {
    this._matchData = await this._matchService.getMatches({ from: opts.from, to: opts.to, limit: opts.limit });
  }

  async saveData(cubes: ICubeItem[] | IMatchCubeItem[], collection: 'matches-by-player' | 'matches'): Promise<void> {
    const rootRef = this.db.collection(MATCHES_BY_PLAYER_COLLECTION + '/' + collection);

    const batch = this.db.batch();
    for (const ci of cubes) {
      const docRef = rootRef.doc(ci._key);
      const docData = Object.assign({}, ci, { _updated: new Date().toISOString() });
      batch.set(docRef, docData, { merge: true });
    }

    await batch.commit();
  }

  async getCubeData(collection: 'matches-by-player' | 'matches', opts: Partial<ICubeFilterOpts> = {}): Promise<any[]> {
    const options: ICubeFilterOpts = Object.assign({ limit: 100, order: 'desc' }, opts);
    let query: any = this.db.collection(MATCHES_BY_PLAYER_COLLECTION + '/' + collection);

    if (options.player) {
      query = query.where('dim_player', '==', options.player);
    }

    if (options.from) {
      query = query.where('dim_time', '>=', options.from);
    }

    const snapshot = await query
      .orderBy('dim_time', options.order)
      .limit(options.limit) // max number of results
      .get();

    if (snapshot.docs) {
      return snapshot.docs.map((p: any) => p.data());
    }
    return [];
  }
  async getDataMart(): Promise<ICubeItem[]> {
    const data: any = {};

    data.MATCH_COUNT = this.countNumberOfMatches();

    const cube: ICubeItem[] = [];

    for (const m of this._matchData) {
      const matchCubeItems = MatchServiceHelper.GetMatchPlayerCube(m as MatchResult);
      cube.push(...matchCubeItems);
    }

    // .reduce((x, y) => {
    //   return x.concat(y);
    // }, []);

    // const test = _.groupBy(ds, (item) => item.homeTeamIds)
    // console.log(test);

    return cube;
  }

  nop(): void {
    throw new Error('Method not implemented.');
  }

  getUniquePlayerIds(): string[] {
    const arrPlayers = this._matchData
      .map(p => {
        const playerIds = [...p.homeTeamIds, ...p.awayTeamIds];
        return playerIds;
      })
      .reduce((x, y) => {
        return x.concat(y);
      }, []);

    return arrPlayers.filter((v, i, a) => a.indexOf(v) === i);
  }

  countNumberOfMatches(): number {
    return this._matchData.length;
  }
}
