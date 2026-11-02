import { Routes } from '@angular/router';

import { HomePage } from './home/home-page';
import { PrivacyPage } from './privacy/privacy-page';
import { CheckEmailPage } from './sign-up/check-email-page';
import { SignUpPage } from './sign-up/sign-up-page';
import { VerifyEmailPage } from './sign-up/verify-email-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Nkabom' },
  // Public: one of the three pages anyone can see without logging in (FR-1.12).
  { path: 'privacy', component: PrivacyPage, title: 'Privacy notice · Nkabom' },
  // Public: sign-up (FR-1.12), and the two steps that confirm the email address (FR-1.2).
  { path: 'sign-up', component: SignUpPage, title: 'Sign up · Nkabom' },
  { path: 'check-email', component: CheckEmailPage, title: 'Check your email · Nkabom' },
  { path: 'verify-email', component: VerifyEmailPage, title: 'Confirm your email · Nkabom' },
];
