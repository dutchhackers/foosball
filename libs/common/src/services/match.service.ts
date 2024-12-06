import { IPlayer } from '../interfaces';
import { IMatchResult, MatchResult } from '../models';
import { IFinalScore } from '../types';
import { checkIfDuplicateExists, totoResult } from '../utils';
import { Collection } from '../utils/firestore-db';
import { CoreService } from './abstract-service';
import { StatsService } from './stats.service';
// import { StatsService } from './stats.service';
export { MatchServiceHelper } from './match-service-helper';

const MATCHES_COLLECTION = Collection.MATCHES;
const PLAYERS_COLLECTION = Collection.PLAYERS;

export interface IMatchFilterOpts {
  playerId?: string;
  from?: string;
  to?: string;
  offset?: number;
  limit: number;
  order: 'asc' | 'desc';
}

export interface IMatchService extends CoreService {
  getMatch(matchId: string): Promise<MatchResult>;
  getMatches(opts: Partial<IMatchFilterOpts>): Promise<MatchResult[]>;
  addSimpleMatchResult(homeTeam: string[], awayTeam: string[], finalScore: IFinalScore, matchData: any): Promise<any>;
  deleteMatch(id: string): Promise<void>;
}

export class MatchService extends CoreService implements IMatchService {
  private _playersRepository: IPlayer[] = [];

  constructor() {
    // TODO: inject 'private readonly statsService: StatsService' in constructor
    super();
  }

  async getMatch(id: string): Promise<MatchResult> {
    const docRef = this.db.collection(MATCHES_COLLECTION).doc(id);
    const match = await this.getDocumentAsObject<MatchResult>(docRef, MatchResult);
    if (match !== null) {
      return match;
    }
    throw new Error('match not found');
  }

  async getMatches(opts: Partial<IMatchFilterOpts> = {}): Promise<MatchResult[]> {
    const options: IMatchFilterOpts = Object.assign({ limit: 20, order: 'desc' }, opts);
    let query: any = this.db.collection(MATCHES_COLLECTION);

    if (opts.playerId) {
      query = query.where('_members', 'array-contains', opts.playerId);
    }

    if (opts.from) {
      console.log('add from ' + opts.from);
      query = query.where('matchDate', '>=', opts.from);
    }

    if (opts.to) {
      console.log('add to ' + opts.to);
      query = query.where('matchDate', '<', opts.to);
    }

    if (opts.offset) {
      query = query.offset(opts.offset);
    }

    const snapshot = await query
      .orderBy('matchDate', options.order)
      .limit(options.limit) // max number of results
      .get();

    return this.wrapAll<MatchResult>(snapshot, MatchResult);
  }

  async addSimpleMatchResult(homeTeamIds: string[], awayTeamIds: string[], finalScore: IFinalScore, matchData: any = {}): Promise<any> {
    // Validate input
    this.validateAddMatchResultInput(homeTeamIds, awayTeamIds, finalScore, matchData);

    const matchDate = matchData.matchDate || new Date().toISOString();
    const homeTeamData = await this.getPlayers(homeTeamIds);
    const awayTeamData = await this.getPlayers(awayTeamIds);
    const toto = totoResult(finalScore);

    const data: any = {
      creationDate: new Date().toISOString(),
      matchDate,
      finalScore: finalScore,
      toto,
      homeTeamIds: homeTeamIds,
      homeTeam: homeTeamData,
      awayTeamIds: awayTeamIds,
      awayTeam: awayTeamData,

      /** private index */
      _members: [...homeTeamIds, ...awayTeamIds].sort(),
    };

    const docRef = this.db.collection(MATCHES_COLLECTION).doc();
    await docRef.set(data);

    // TODO: we should end function here
    // TODO: publish 'new match' event
    // TODO: code below should be handled in a subscriber

    // Calculate stats
    await this.calculateStats({
      creationDate: data.creationDate,
      matchDate,
      finalScore,
      toto,
      homeTeamIds,
      awayTeamIds,
      homeTeam: homeTeamData,
      awayTeam: awayTeamData,
    });

    // const match = await this.getMatch(docRef.id);

    // TODO: fix publisher!
    // const publisher = new Publisher();
    // await publisher.publishMessage(serialize(match), 'match-result');
  }

  async deleteMatch(matchId: string): Promise<void> {
    try {
      const docRef = this.db.collection(MATCHES_COLLECTION).doc(matchId);
      const doc = await docRef.get();
      if (!doc.exists) {
        throw Error('Match Not Found');
      }

      const docData: any = Object.assign({}, doc.data() || {});

      const matchResult = <IMatchResult>docData;

      // Delete match
      await docRef.delete();
      console.log('[DELETE MATCH] Match deleted', matchResult);

      // Try to clear stats
      await this.calculateStats(matchResult, -1);

      return;
    } catch (e) {
      console.log('[deleteMatch] Error', e);
      return;
    }
  }

  private async calculateStats(matchResult: IMatchResult, multiplier = 1) {
    const statsService = new StatsService();
    await statsService.generateStats(matchResult, { multiplier });
  }

  private async getPlayers(arrPlayers: string[]): Promise<any> {
    if (this._playersRepository.length === 0) {
      const query = this.db.collection(PLAYERS_COLLECTION);
      this._playersRepository = this.wrapAll(await query.get());
    }

    const result = arrPlayers.map(p => {
      const player = this._playersRepository.find(q => q.id === p);
      if (!player) {
        console.log('Not found: ' + p);
        return;
      }
      return {
        id: p,
        name: player.name,
        avatar: player.avatar,
      };
    });
    return result;
  }

  private validateAddMatchResultInput(homeTeam: string[], awayTeam: string[], finalScore: IFinalScore, matchData: any = {}): void {
    // Validate: check uniqueness of players
    if (checkIfDuplicateExists([...homeTeam, ...awayTeam])) {
      throw Error('Duplicate player entry found');
    }
  }
}
