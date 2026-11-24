import { describe, expect, it } from 'vitest';

import { HttpError } from './http';
import { isAdmin, requireAdmin } from './roles';
import type { Account } from './users';

function accountWith(role: string): Account {
  return { uid: 'ama', name: null, email: null, emailVerified: true, roleClaim: null, role };
}

describe('requireAdmin', () => {
  it.each(['admin', 'primaryAdmin'])('lets a %s through', (role) => {
    expect(isAdmin(accountWith(role))).toBe(true);
    expect(() => requireAdmin(accountWith(role))).not.toThrow();
  });

  it.each(['member', '', 'Admin', 'undefined', 'superuser'])('refuses the role "%s"', (role) => {
    expect(isAdmin(accountWith(role))).toBe(false);
    expect(() => requireAdmin(accountWith(role))).toThrow(HttpError);
  });
});
