import type { DocumentData } from 'firebase-admin/firestore';
import { CoreService } from '../core/abstract-service';
import { IPlayer, IPlayerStats } from './player.interface';
import { Player } from './player.model';

const PLAYERS_COLLECTION = 'players';

export class PlayerService extends CoreService {
  constructor() {
    super();
  }

  async registerPlayer(email: string, name: string, data: { avatar?: string; slackId?: string } = {}): Promise<Player> {
    if (!email || !name) {
      throw Error('Bad Request');
    }

    const createPlayerInput: Partial<IPlayer> = {};
    createPlayerInput.id = email;
    createPlayerInput.name = name;

    if (data.avatar) {
      createPlayerInput.avatar = data.avatar;
    }

    if (data.slackId) {
      createPlayerInput.slackId = data.slackId;
    }

    return this.addPlayer(createPlayerInput);
  }

  async addPlayer({ id, name, avatar, slackId }: Partial<Player>): Promise<Player> {
    if (!id || !name) {
      throw Error('Missing id or name');
    }

    const exists: boolean = await this.exists(id);
    if (exists) {
      throw Error('Player already exists');
    }

    const player: Partial<IPlayer> = {};
    (player.id = id), (player.name = name);

    if (avatar) {
      player.avatar = avatar;
    }

    if (slackId) {
      player.slackId = slackId;
    }

    const docRef = this.db.collection(PLAYERS_COLLECTION).doc(player.id!);
    await docRef.set(Object.assign(player, { last_modified: new Date().toISOString() }));
    return this.getPlayer(player.id!);
  }

  async updatePlayer(id: string, { name, nickname, avatar, slackId, status, quote }: Partial<Player>): Promise<void> {
    console.log('updatePlayer', {
      id,
      name,
      nickname,
      avatar,
      slackId,
      status,
      quote,
    });
    if (!id) {
      throw Error('id  is null');
    }

    const exists: boolean = await this.exists(id);
    if (!exists) {
      throw Error('Player not found');
    }

    const payload: Partial<IPlayer> = {};
    payload.id = id;

    if (name) {
      payload.name = name;
    }

    if (nickname !== undefined) {
      payload.nickname = nickname;
    }

    if (avatar) {
      payload.avatar = avatar;
    }

    if (slackId !== undefined) {
      payload.slackId = slackId;
    }

    if (status !== undefined) {
      payload.status = status;
    }
    if (quote !== undefined) {
      payload.quote = quote;
    }
    const docRef = this.db.collection(PLAYERS_COLLECTION).doc(id);
    await docRef.set(Object.assign(payload, { modificationDate: new Date().toISOString() }), { merge: true });
  }

  async updatePlayerStats(id: string, stats: Partial<IPlayerStats>): Promise<void> {
    if (!id) {
      throw Error('id is null');
    }

    const exists: boolean = await this.exists(id);
    if (!exists) {
      throw Error('Player not found');
    }

    const docRef = this.db.collection(PLAYERS_COLLECTION).doc(id);
    await docRef.set(
      {
        ...stats,
        modificationDate: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  async getPlayer(id: string): Promise<Player> {
    const docRef = this.db.collection(PLAYERS_COLLECTION).doc(id);
    const player = await this.getDocumentAsObject<Player>(docRef, Player);
    if (player !== null) {
      return player;
    }
    throw new Error('player not found');
  }

  async getPlayerBySlackId(slackId: string): Promise<Player> {
    const query = this.db.collection(PLAYERS_COLLECTION).where('slackId', '==', slackId).limit(1);

    const snapshot = await query.get();
    const data = await this.wrapAll<Player>(snapshot, Player);
    if (data.length) {
      return data[0];
    }
    return null;
    // throw new Error('player not found');
  }

  async getPlayersById(ids: string[]): Promise<IPlayer[]> {
    return Promise.all(ids.map((id: string) => this.getPlayer(id)));
  }

  async getPlayers(filter: any = {}): Promise<Player[]> {
    const query = this.db.collection(PLAYERS_COLLECTION).where('active', '==', true);
    const snapshot = await query.get();
    return this.wrapAll<Player>(snapshot, Player);
  }

  private async exists(id: string): Promise<boolean> {
    const snapshot = await this.db.collection(PLAYERS_COLLECTION).doc(id).get();
    return snapshot.exists;
  }

  private async getData() {
    const snapshotItems = await this.db
      .collection(PLAYERS_COLLECTION)
      // .orderBy('createdAt', 'desc')
      // .limitToLast(5)
      .get();
    if (!snapshotItems.size) {
      return [];
    }
    return snapshotItems.docs.map(snapshot => this.map(snapshot.data()));
  }

  private map(data: DocumentData) {
    return {
      ...data,
      id: 1,
      // createdAt: FirestoreTimestampToDate(data.createdAt),
      // startedAt: FirestoreTimestampToDate(data.startedAt),
      // closedAt: FirestoreTimestampToDate(data.closedAt),
    };
  }
}
