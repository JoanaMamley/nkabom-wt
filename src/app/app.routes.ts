import { Routes } from '@angular/router';

import { signedOutOnly, verifiedOnly } from './core/guards';
import { HomePage } from './home/home-page';
import { LoginPage } from './login/login-page';
import { PrivacyPage } from './privacy/privacy-page';
import { CheckEmailPage } from './sign-up/check-email-page';
import { SignUpPage } from './sign-up/sign-up-page';
import { VerifyEmailPage } from './sign-up/verify-email-page';

// fullScreen: the page brings its own layout (AuthLayout), so the app's header and footer hide.
const fullScreen = { fullScreen: true };

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  // Public: login, sign-up and the privacy notice are the three pages anyone can see (FR-1.12),
  // with the two steps that confirm a sign-up's email address (FR-1.2).
  {
    path: 'login',
    component: LoginPage,
    canActivate: [signedOutOnly],
    data: fullScreen,
    title: 'Log in · Nkabom',
  },
  {
    path: 'sign-up',
    component: SignUpPage,
    canActivate: [signedOutOnly],
    data: fullScreen,
    title: 'Sign up · Nkabom',
  },
  { path: 'privacy', component: PrivacyPage, title: 'Privacy notice · Nkabom' },
  {
    path: 'check-email',
    component: CheckEmailPage,
    data: fullScreen,
    title: 'Check your email · Nkabom',
  },
  {
    path: 'verify-email',
    component: VerifyEmailPage,
    data: fullScreen,
    title: 'Confirm your email · Nkabom',
  },
  // Logged in.
  { path: 'home', component: HomePage, canActivate: [verifiedOnly], title: 'Nkabom' },
];
