import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { NxWelcomeComponent } from './nx-welcome.component';
import { Observable } from 'rxjs';
import { collection } from "firebase/firestore";
import { collectionData, Firestore } from '@angular/fire/firestore';
import { CommonModule } from '@angular/common';

interface Item {
  name: string,
};

@Component({
  standalone: true,
  imports: [NxWelcomeComponent, RouterModule, CommonModule],
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  item$: Observable<any[]>;
  firestore: Firestore = inject(Firestore);

  constructor() {
    const itemCollection = collection(this.firestore, 'players');
    this.item$ = collectionData<any>(itemCollection);
    // this.addData();
  }
  title = 'web';

  // async addData() {
  //   const result = await setDoc(doc(this.firestore, 'players'), {
  //     name: "Owen Klever",
  //     nickname: "Owen",
  //     id: "owen.klever@moveagency.com"
  //   });
  //   console.log(result);
  // }
}
