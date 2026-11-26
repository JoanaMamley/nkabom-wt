import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Accounts } from '../core/accounts';
import { Api } from '../core/api';
import { Session } from '../core/session';
import { HomePage } from './home-page';

describe('HomePage', () => {
  const api = { get: vi.fn() };

  beforeEach(() => {
    api.get.mockReset();
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        {
          provide: Accounts,
          useValue: { currentUser: async () => ({ email: 'efua@example.com' }) },
        },
        { provide: Session, useValue: { logOut: vi.fn() } },
      ],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HomePage);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    // ngOnInit awaits the account, then the role.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('offers a Primary Admin the page to manage admins (FR-1.6, FR-1.7)', async () => {
    api.get.mockResolvedValue({ uid: 'efua', role: 'primaryAdmin' });
    const page = await render();

    expect(page.querySelector('a[href="/admins"]')?.textContent).toContain('Manage admins');
  });

  it('offers it to no one else, nor when the role is unknown', async () => {
    for (const result of [{ role: 'admin' }, { role: 'member' }]) {
      api.get.mockResolvedValue(result);
      expect((await render()).querySelector('a[href="/admins"]')).toBeNull();
    }
    api.get.mockRejectedValue(new Error('unreachable'));
    expect((await render()).querySelector('a[href="/admins"]')).toBeNull();
  });
});
