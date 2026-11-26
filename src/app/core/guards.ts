import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';

import { Accounts } from './accounts';
import { Session } from './session';

/**
 * Who may open a page, given as route data `access`. A page that says nothing is for logged-in
 * members only, so a new page is closed until it says otherwise (FR-1.12).
 * - public: anyone, logged in or not.
 * - signedOut: anyone, but someone already logged in goes straight to their home page.
 */
export type Access = 'public' | 'signedOut';

/**
 * Default deny over every route (FR-1.12, NKB-206): app.routes.ts puts every page under one parent
 * that runs this. Anyone not logged in with a verified email address goes to the login page from
 * every page not marked public. Session expiry is watched from here too, whichever way the member
 * arrived, such as straight after confirming their email.
 */
export const defaultDeny: CanActivateChildFn = async (route) => {
  // Injected before awaiting, since inject() works only before the first await.
  const [accounts, router, session] = [inject(Accounts), inject(Router), inject(Session)];
  const access = route.data['access'] as Access | undefined;
  if (access === 'public') {
    return true;
  }
  const user = await accounts.currentUser();
  const loggedIn = user?.emailVerified === true;
  if (access === 'signedOut') {
    return loggedIn ? router.parseUrl('/home') : true;
  }
  if (!loggedIn) {
    return router.parseUrl('/login');
  }
  void session.resume();
  return true;
};
