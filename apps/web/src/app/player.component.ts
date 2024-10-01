import { RouterModule } from '@angular/router';
import { NxWelcomeComponent } from './nx-welcome.component';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { Component, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Player } from '@foosball/common';

@Component({
    standalone: true,
    imports: [NxWelcomeComponent, RouterModule],
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
})

export class PlayerComponent {
    private firestore: Firestore = inject(Firestore);
    players$: Observable<Player[]>;

    constructor() {
        const playersCollection = collection(this.firestore, 'players');
        this.players$ = collectionData(playersCollection).pipe(
            map(players => players as Player[])
        );
    }
}

export interface PlayerName {
    name: string;
}
