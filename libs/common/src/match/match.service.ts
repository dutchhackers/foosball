import { FieldValue, FieldPath, Transaction } from 'firebase-admin/firestore'; // Added Transaction
import { CoreService } from '../core/abstract-service';
import { checkIfDuplicateExists, totoResult } from '../core/utils';
import { Collection } from '../core/utils/firestore-db';
import { IPlayer, Player } from '../player';
import { StatsService } from '../statistics/stats.service';
import { IFinalScore } from './final-score.type';
import { IMatchResult, MatchResult, MatchResultPlayer } from './match-result.model';

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
  addSimpleMatchResult(homeTeamIds: string[], awayTeamIds: string[], finalScore: IFinalScore, matchData?: any): Promise<IMatchResult>;
  deleteMatch(id: string): Promise<void>;
}

export class MatchService extends CoreService implements IMatchService {
  private _playersRepository: Player[] = [];
  private statsService: StatsService;

  constructor() {
    super();
    this.statsService = new StatsService();
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
    let query: FirebaseFirestore.Query = this.db.collection(MATCHES_COLLECTION);

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
      console.warn('Offset pagination is deprecated/inefficient. Consider cursor-based pagination (startAfter).');
      query = query.offset(opts.offset);
    }

    const snapshot = await query.orderBy('matchDate', options.order).limit(options.limit).get();

    return this.wrapAll<MatchResult>(snapshot, MatchResult);
  }

  async addSimpleMatchResult(
    homeTeamIds: string[],
    awayTeamIds: string[],
    finalScore: IFinalScore,
    matchData: any = {}
  ): Promise<IMatchResult> {
    this.validateAddMatchResultInput(homeTeamIds, awayTeamIds, finalScore, matchData);

    const matchDate = matchData.matchDate || new Date().toISOString();
    // Fetch players before transaction
    const homeTeamData = await this.getPlayers(homeTeamIds);
    const awayTeamData = await this.getPlayers(awayTeamIds);
    const toto = totoResult(finalScore);
    const allPlayerIds = [...homeTeamIds, ...awayTeamIds].sort();

    const newMatchData: IMatchResult & { _members: string[] } = {
      creationDate: new Date().toISOString(),
      matchDate,
      finalScore: finalScore,
      toto,
      homeTeamIds: homeTeamIds,
      homeTeam: homeTeamData,
      awayTeamIds: awayTeamIds,
      awayTeam: awayTeamData,
      _members: allPlayerIds,
    };

    const matchRef = this.db.collection(MATCHES_COLLECTION).doc();

    try {
      await this.db.runTransaction(async (transaction: Transaction) => {
        // Explicitly type transaction
        // --- Execute Reads FIRST ---
        // generateStats now handles its internal reads (getAll) before its writes.
        // No other explicit reads are needed here for this specific operation.

        // --- Now, execute ALL Writes ---
        // 1. Call generateStats to perform its *writes* (player stats, time-based stats)
        //    It already performed its internal reads correctly.
        await this.statsService.generateStats(transaction, newMatchData, { multiplier: 1 });

        // 2. Write the match document *after* generateStats has done its reads+writes
        transaction.set(matchRef, newMatchData);
      }); // Transaction commits automatically if successful

      console.log(`Match ${matchRef.id} created and stats updated within transaction.`);

      // Update streaks *after* successful transaction commit
      await this.statsService.batchUpdateStreaks(allPlayerIds);

      const createdDoc = await matchRef.get();
      if (!createdDoc.exists) {
        throw new Error('Failed to retrieve the created match document after transaction.');
      }
      return createdDoc.data() as IMatchResult;
    } catch (error: any) {
      console.error(`Transaction failed for match creation [${matchRef.id}]: `, error);
      throw new Error(`Failed to add match result: ${error.message || error}`);
    }
  }

  async deleteMatch(matchId: string): Promise<void> {
    const matchRef = this.db.collection(MATCHES_COLLECTION).doc(matchId);
    let allPlayerIds: string[] = [];

    try {
      const preliminaryMatchDoc = await matchRef.get();
      if (preliminaryMatchDoc.exists) {
        const prelimData = preliminaryMatchDoc.data() as IMatchResult;
        allPlayerIds = [...(prelimData.homeTeamIds || []), ...(prelimData.awayTeamIds || [])].sort();
      } else {
        console.warn(`Attempted to delete non-existent match: ${matchId}`);
        return;
      }

      await this.db.runTransaction(async (transaction: Transaction) => {
        // Explicitly type transaction
        // --- Execute Reads FIRST ---
        const matchDoc = await transaction.get(matchRef); // Read match doc for data & existence check

        if (!matchDoc.exists) {
          console.warn(`Match ${matchId} was deleted concurrently before delete transaction.`);
          return; // Exit transaction gracefully
        }
        const matchResult = matchDoc.data() as IMatchResult;

        // Call generateStats, which handles its internal reads (getAll for time-based)
        // These reads happen before the writes below.

        // --- Now, execute ALL Writes ---
        // 1. Perform stats reversal writes (player stats, time-based stats)
        await this.statsService.generateStats(transaction, matchResult, { multiplier: -1 });

        // 2. Delete the match document
        transaction.delete(matchRef);
      }); // Transaction commits automatically

      console.log(`Match ${matchId} deleted and stats reversal triggered within transaction.`);

      // Update streaks *after* successful transaction commit
      if (allPlayerIds.length > 0) {
        await this.statsService.batchUpdateStreaks(allPlayerIds);
      }
    } catch (error: any) {
      console.error(`[deleteMatch ${matchId}] Transaction failed: `, error);
      throw error;
    }
  }

  private async getPlayers(arrPlayers: string[]): Promise<MatchResultPlayer[]> {
    const missingPlayers = arrPlayers.filter(id => !this._playersRepository.some(p => p.id === id));

    if (missingPlayers.length > 0) {
      console.log(`Fetching missing players: ${missingPlayers.join(', ')}`);
      const chunks = [];
      for (let i = 0; i < missingPlayers.length; i += 30) {
        chunks.push(missingPlayers.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        if (chunk.length > 0) {
          const query = this.db.collection(PLAYERS_COLLECTION).where(FieldPath.documentId(), 'in', chunk);
          const snapshot = await query.get();
          const fetchedPlayers = this.wrapAll<Player>(snapshot, Player);
          fetchedPlayers.forEach(fp => {
            if (!this._playersRepository.some(p => p.id === fp.id)) {
              this._playersRepository.push(fp);
            }
          });
        }
      }
    }

    const result = arrPlayers
      .map(id => {
        const player = this._playersRepository.find(q => q.id === id);
        if (!player) {
          console.error(`Player ${id} not found in repository after fetch attempt.`);
          return undefined;
        }
        return { id: player.id, name: player.name, avatar: player.avatar };
      })
      .filter((p): p is MatchResultPlayer => p !== undefined);

    if (result.length !== arrPlayers.length) {
      const foundIds = result.map(p => p.id);
      const stillMissing = arrPlayers.filter(id => !foundIds.includes(id));
      throw new Error(`Could not find all requested players. Missing: ${stillMissing.join(', ')}`);
    }

    return result;
  }

  private validateAddMatchResultInput(homeTeamIds: string[], awayTeamIds: string[], finalScore: IFinalScore, matchData: any = {}): void {
    if (!Array.isArray(homeTeamIds) || homeTeamIds.length === 0) {
      throw new Error('Home team cannot be empty and must be an array of player IDs.');
    }
    if (!Array.isArray(awayTeamIds) || awayTeamIds.length === 0) {
      throw new Error('Away team cannot be empty and must be an array of player IDs.');
    }
    if (homeTeamIds.length !== awayTeamIds.length || homeTeamIds.length > 2 || homeTeamIds.length < 1) {
      throw new Error(`Invalid team sizes. Home: ${homeTeamIds.length}, Away: ${awayTeamIds.length}. Only 1v1 or 2v2 supported.`);
    }
    if (
      !Array.isArray(finalScore) ||
      finalScore.length !== 2 ||
      typeof finalScore[0] !== 'number' ||
      typeof finalScore[1] !== 'number' ||
      finalScore[0] < 0 ||
      finalScore[1] < 0
    ) {
      throw new Error(`Invalid final score format or negative values: [${finalScore[0]}, ${finalScore[1]}]`);
    }
    const score1 = finalScore[0];
    const score2 = finalScore[1];
    if (score1 > 11 || score2 > 11) {
      throw new Error(`Invalid final score: scores cannot exceed 11. Score: [${score1}, ${score2}]`);
    }
    const maxScore = Math.max(score1, score2);
    const minScore = Math.min(score1, score2);
    if (maxScore < 10) {
      if (score1 !== 0 || score2 !== 0) {
        console.warn(`Potential invalid score: Neither team reached 10. Score: [${score1}, ${score2}]`);
      }
    } else if (maxScore === 10 && minScore === 10) {
      throw new Error(`Invalid final score: cannot tie at 10-10. Score: [${score1}, ${score2}]`);
    } else if (maxScore === 11 && minScore === 11) {
      throw new Error(`Invalid final score: cannot tie at 11-11. Score: [${score1}, ${score2}]`);
    } else if (maxScore === 11 && minScore > 10) {
      throw new Error(`Invalid final score: If one team scores 11, the other must have 10 or less. Score: [${score1}, ${score2}]`);
    } else if (maxScore === 10 && minScore >= 10) {
      throw new Error(`Invalid final score: If one team scores 10, the other must have less than 10. Score: [${score1}, ${score2}]`);
    }
    if (checkIfDuplicateExists([...homeTeamIds, ...awayTeamIds])) {
      throw new Error('Duplicate player entry found. A player cannot be on both teams.');
    }
    if (matchData.matchDate) {
      try {
        const d = new Date(matchData.matchDate);
        if (isNaN(d.getTime())) {
          throw new Error('Invalid date value');
        }
      } catch (e) {
        throw new Error(`Invalid matchDate format or value: ${matchData.matchDate}. Please use ISO 8601 format.`);
      }
    }
  }
}
