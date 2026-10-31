import { Routes } from '@angular/router';

import { HomePage } from './home/home-page';
import { PrivacyPage } from './privacy/privacy-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Nkabom' },
  // Public: one of the three pages anyone can see without logging in (FR-1.12).
  { path: 'privacy', component: PrivacyPage, title: 'Privacy notice · Nkabom' },
];
