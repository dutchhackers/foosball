import type { Firestore, QuerySnapshot, DocumentReference, DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';
// TODO: refactor out serializer
import { deserialize, ClazzOrModelSchema } from 'serializr';

import { db } from '../core/config/firebase.config';

export abstract class CoreService {
  //privates?
  db: Firestore;

  constructor() {
    this.db = db;
  }

  protected wrapAll<T>(snapshot: QuerySnapshot, modelschema: ClazzOrModelSchema<T> | null = null): T[] {
    const docs: T[] = [];
    for (const doc of snapshot.docs) {
      if (modelschema) {
        docs.push(this.serializeDocument<T>(modelschema, doc));
      } else {
        docs.push(<T>doc.data());
      }
    }
    return docs;
  }

  protected async getDocumentAsObject<T>(
    docRef: DocumentReference,
    modelschema: ClazzOrModelSchema<T>
  ): Promise<T | null> {
    const snapshot = await docRef.get();
    if (snapshot !== null) {
      return this.serializeDocument<T>(modelschema, snapshot);
    }
    return null;
  }

  protected async firebaseSetDocument(docRef: DocumentReference, data: any): Promise<any> {
    const _data = cleanInput(data);
    return docRef.set(_data);
  }

  protected serializeDocument<T>(
    modelschema: ClazzOrModelSchema<T>,
    snapshot: DocumentSnapshot | QueryDocumentSnapshot
  ): T {
    return Object.assign(deserialize(modelschema, snapshot.data()), { _docId: snapshot.id });
  }
}

function cleanInput(input: any, options: any = {}): any {
  Object.keys(input).forEach(key => (input[key] === undefined ? delete input[key] : ''));
  return input;
}
