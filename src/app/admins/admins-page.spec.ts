import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Api, ApiError } from '../core/api';
import { type Admin, AdminsPage } from './admins-page';

const EFUA: Admin = {
  uid: 'efua',
  name: 'Efua Asante',
  email: 'efua@example.com',
  calendarEmail: 'efua@example.com',
  role: 'primaryAdmin',
  status: 'active',
  self: true,
};
const ESI: Admin = {
  ...EFUA,
  uid: 'esi',
  name: 'Esi Owusu',
  email: 'esi@example.com',
  self: false,
};
const KOFI: Admin = {
  ...ESI,
  uid: 'kofi',
  name: 'Kofi Boateng',
  email: 'kofi@example.com',
  calendarEmail: 'kofi@gmail.com',
  role: 'admin',
};

describe('AdminsPage', () => {
  const api = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  let admins: Admin[];
  let confirm: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    admins = [EFUA, ESI, KOFI];
    api.get.mockReset().mockImplementation(async () => ({ admins }));
    api.post.mockReset().mockResolvedValue({});
    api.patch.mockReset().mockResolvedValue({});
    api.delete.mockReset().mockResolvedValue({});
    confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [AdminsPage],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render() {
    const fixture = TestBed.createComponent(AdminsPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    /** The list entry for the admin with this name. */
    const entry = (name: string) =>
      [...page.querySelectorAll<HTMLElement>('.admins > li')].find((li) =>
        li.querySelector('h2')?.textContent?.includes(name),
      )!;

    /** Clicks the named button in that admin's entry and waits for the page to settle. */
    async function click(name: string, button: string) {
      const target = [...entry(name).querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === button,
      );
      if (!target) {
        throw new Error(`${name} has no ${button} button`);
      }
      target.click();
      await fixture.whenStable();
    }

    const buttons = (name: string) =>
      [...entry(name).querySelectorAll('button')].map((button) => button.textContent?.trim());

    return { page, entry, click, buttons };
  }

  it('lists the admins with their role, marking the viewer, and links to adding one', async () => {
    const { page, entry } = await render();

    expect(api.get).toHaveBeenCalledWith('/v1/admins');
    expect(entry('Efua Asante').textContent).toContain('(you)');
    expect(entry('Efua Asante').textContent).toContain('Primary Admin');
    expect(entry('Kofi Boateng').textContent).toMatch(
      /kofi@example\.com[\s\S]*Calendar: kofi@gmail\.com/,
    );
    expect(page.querySelector('a[href="/admins/new"]')?.textContent).toContain('Add an admin');
  });

  it('offers nothing on the viewer’s own account', async () => {
    const { entry } = await render();

    expect(entry('Efua Asante').querySelectorAll('button')).toHaveLength(0);
  });

  it('offers promotion to an admin and demotion to another Primary Admin (FR-1.7)', async () => {
    const { buttons } = await render();

    expect(buttons('Kofi Boateng')).toEqual(['Make Primary Admin', 'Deactivate', 'Delete']);
    expect(buttons('Esi Owusu')).toEqual(['Make admin', 'Deactivate', 'Delete']);
  });

  it('names the admin in each button for screen readers', async () => {
    const { entry } = await render();

    expect(
      [...entry('Kofi Boateng').querySelectorAll('button')].map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Make Kofi Boateng a Primary Admin',
      'Deactivate Kofi Boateng',
      'Delete Kofi Boateng',
    ]);
  });

  it('promotes an admin and shows the new list', async () => {
    const { page, click, entry } = await render();
    admins = [EFUA, ESI, { ...KOFI, role: 'primaryAdmin' }];

    await click('Kofi Boateng', 'Make Primary Admin');

    expect(api.patch).toHaveBeenCalledWith('/v1/admins/kofi', { role: 'primaryAdmin' });
    expect(page.querySelector('[role="status"]')?.textContent).toContain(
      'Kofi Boateng is now a Primary Admin.',
    );
    expect(entry('Kofi Boateng').textContent).toContain('Primary Admin');
  });

  it('demotes another Primary Admin', async () => {
    const { click } = await render();

    await click('Esi Owusu', 'Make admin');

    expect(api.patch).toHaveBeenCalledWith('/v1/admins/esi', { role: 'admin' });
  });

  it('deactivates an admin once confirmed, then offers only deletion', async () => {
    const { page, click, buttons, entry } = await render();
    admins = [EFUA, ESI, { ...KOFI, status: 'deactivated' }];

    await click('Kofi Boateng', 'Deactivate');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Deactivate Kofi Boateng?'));
    expect(api.post).toHaveBeenCalledWith('/v1/admins/kofi/deactivate');
    expect(page.querySelector('[role="status"]')?.textContent).toContain(
      'Kofi Boateng has been deactivated and logged out.',
    );
    expect(entry('Kofi Boateng').textContent).toContain('Deactivated');
    expect(buttons('Kofi Boateng')).toEqual(['Reactivate', 'Delete']);
  });

  it('reactivates a deactivated admin', async () => {
    admins = [EFUA, ESI, { ...KOFI, status: 'deactivated' }];
    const { page, click, buttons } = await render();
    admins = [EFUA, ESI, KOFI];

    await click('Kofi Boateng', 'Reactivate');

    expect(api.post).toHaveBeenCalledWith('/v1/admins/kofi/reactivate');
    expect(page.querySelector('[role="status"]')?.textContent).toContain(
      'Kofi Boateng has been reactivated and can log in again with their password.',
    );
    expect(buttons('Kofi Boateng')).toEqual(['Make Primary Admin', 'Deactivate', 'Delete']);
  });

  it('deletes an admin once confirmed', async () => {
    const { page, click } = await render();
    admins = [EFUA, ESI];

    await click('Kofi Boateng', 'Delete');

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'));
    expect(api.delete).toHaveBeenCalledWith('/v1/admins/kofi');
    expect(page.querySelector('[role="status"]')?.textContent).toContain(
      'Kofi Boateng’s admin account has been deleted.',
    );
    expect(page.textContent).not.toContain('kofi@example.com');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    confirm.mockReturnValue(false);
    const { click } = await render();

    await click('Kofi Boateng', 'Deactivate');
    await click('Kofi Boateng', 'Delete');

    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('shows the Worker’s reason when an action is refused, and reloads the list', async () => {
    api.delete.mockRejectedValue(
      new ApiError(502, 'The admin’s sign-in could not be deleted, so they have been deactivated'),
    );
    const { page, click, entry } = await render();
    admins = [EFUA, ESI, { ...KOFI, status: 'deactivated' }];

    await click('Kofi Boateng', 'Delete');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be deleted, so they have been deactivated',
    );
    expect(page.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
    expect(entry('Kofi Boateng').textContent).toContain('Deactivated');
  });

  it('tells anyone but a Primary Admin that they cannot manage admins', async () => {
    api.get.mockRejectedValue(new ApiError(403, 'Only a Primary Admin can do this'));
    const { page } = await render();

    expect(page.textContent).toContain('Only a Primary Admin can manage admins.');
    expect(page.querySelector('.admins')).toBeNull();
  });

  it('says why the list could not be loaded', async () => {
    api.get.mockRejectedValue(new ApiError(0, 'Nkabom could not be reached.'));
    const { page } = await render();

    expect(page.textContent).toContain('Nkabom could not be reached.');
  });
});
