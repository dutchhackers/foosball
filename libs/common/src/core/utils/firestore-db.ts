// Aliased: this module exports its own `Firestore` holder class, which would
// otherwise collide with the SDK type that `FirebaseFirestore.Firestore`
// used to disambiguate.
import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';

let _db: AdminFirestore;

export class Firestore {
  static initialize(instance: AdminFirestore) {
    _db = instance;
  }

  static get db(): AdminFirestore {
    //error handling; null check
    return _db;
  }
}

export enum Collection {
  PLAYERS = 'players',
  MATCHES = 'matches',
  TEAM_STATS = 'team-stats',
}
