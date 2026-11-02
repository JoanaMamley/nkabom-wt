import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Accounts } from './accounts';

// Route guards for the pages so far. NKB-206 replaces them with default-deny over every route.
// Both inject before awaiting, since inject() works only before the first await.

/** Login and sign-up: someone already logged in goes straight to their home page. */
export const signedOutOnly: CanActivateFn = async () => {
  const [accounts, router] = [inject(Accounts), inject(Router)];
  const user = await accounts.currentUser();
  return user?.emailVerified ? router.parseUrl('/home') : true;
};

/** Pages for logged-in members: anyone else goes to the login page. */
export const verifiedOnly: CanActivateFn = async () => {
  const [accounts, router] = [inject(Accounts), inject(Router)];
  const user = await accounts.currentUser();
  return user?.emailVerified ? true : router.parseUrl('/login');
};
