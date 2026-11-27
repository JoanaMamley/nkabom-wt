import { Routes } from '@angular/router';

import { AddAdminPage } from './admins/add-admin-page';
import { AdminsPage } from './admins/admins-page';
import { Access, defaultDeny } from './core/guards';
import { HomePage } from './home/home-page';
import { LoginPage } from './login/login-page';
import { ForgotPasswordPage } from './password-reset/forgot-password-page';
import { ResetPasswordPage } from './password-reset/reset-password-page';
import { PrivacyPage } from './privacy/privacy-page';
import { CheckEmailPage } from './sign-up/check-email-page';
import { SignUpPage } from './sign-up/sign-up-page';
import { VerifyEmailPage } from './sign-up/verify-email-page';
import { TermsPage } from './terms/terms-page';

// fullScreen: the page brings its own layout (AuthLayout), so the app's header and footer hide.
function open(access: Access, fullScreen = true) {
  return fullScreen ? { access, fullScreen } : { access };
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    // Default deny (FR-1.12, NKB-206): every page goes here, and is for logged-in members unless
    // its data opens it with open(). Only login, sign-up, the privacy notice and the terms of
    // service (NKB-212, which Meta and Google read logged out) are open, with the two steps that
    // confirm a sign-up's email address (FR-1.2), which the emailed link may open on another
    // device, the two that reset a forgotten password (FR-1.4), and the one where a new admin sets
    // their first password (FR-1.8).
    path: '',
    canActivateChild: [defaultDeny],
    children: [
      { path: 'login', component: LoginPage, data: open('signedOut'), title: 'Log in · Nkabom' },
      {
        path: 'sign-up',
        component: SignUpPage,
        data: open('signedOut'),
        title: 'Sign up · Nkabom',
      },
      {
        path: 'privacy',
        component: PrivacyPage,
        data: open('public', false),
        title: 'Privacy notice · Nkabom',
      },
      {
        path: 'terms',
        component: TermsPage,
        data: open('public', false),
        title: 'Terms of service · Nkabom',
      },
      {
        path: 'check-email',
        component: CheckEmailPage,
        data: open('public'),
        title: 'Check your email · Nkabom',
      },
      {
        path: 'verify-email',
        component: VerifyEmailPage,
        data: open('public'),
        title: 'Confirm your email · Nkabom',
      },
      {
        path: 'forgot-password',
        component: ForgotPasswordPage,
        data: open('signedOut'),
        title: 'Forgot password · Nkabom',
      },
      {
        path: 'reset-password',
        component: ResetPasswordPage,
        data: open('public'),
        title: 'Reset password · Nkabom',
      },
      // A new admin's first password (FR-1.8), from the link they are emailed.
      {
        path: 'set-password',
        component: ResetPasswordPage,
        data: { ...open('public'), firstPassword: true },
        title: 'Set your password · Nkabom',
      },
      // Logged in.
      { path: 'home', component: HomePage, title: 'Nkabom' },
      // A Primary Admin manages the admins (FR-1.6, FR-1.7) and adds them. The Worker refuses
      // anyone else.
      { path: 'admins', component: AdminsPage, title: 'Admins · Nkabom' },
      { path: 'admins/new', component: AddAdminPage, title: 'Add an admin · Nkabom' },
    ],
  },
  // A mistyped or old address goes to login, which sends anyone logged in on to their home page.
  { path: '**', redirectTo: 'login' },
];
