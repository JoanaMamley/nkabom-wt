import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Api, ApiError } from '../core/api';
import { AddAdminPage, MAX_NAME_LENGTH } from './add-admin-page';

describe('AddAdminPage', () => {
  const api = { get: vi.fn(), post: vi.fn() };

  beforeEach(() => {
    api.get.mockReset().mockResolvedValue({ uid: 'efua', role: 'primaryAdmin' });
    api.post.mockReset().mockImplementation(async (_path, body: Record<string, string>) => ({
      uid: 'abena',
      email: body['email'].toLowerCase(),
      name: body['name'],
      calendarEmail: (body['calendarEmail'] ?? body['email']).toLowerCase(),
    }));
    TestBed.configureTestingModule({
      imports: [AddAdminPage],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(AddAdminPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    async function add(fields: { name?: string; email?: string; calendarEmail?: string }) {
      for (const [id, value] of [
        ['name', fields.name],
        ['email', fields.email],
        ['calendar-email', fields.calendarEmail],
      ]) {
        const input = page.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value ?? '';
        input.dispatchEvent(new Event('input'));
      }
      page.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    }

    return { page, add, fixture };
  }

  it('asks a Primary Admin for the name, login email and calendar email', async () => {
    const { page } = await render();

    expect(page.querySelector('h1')?.textContent).toContain('Add an admin');
    for (const id of ['name', 'email', 'calendar-email']) {
      expect(page.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });

  it('adds the admin and says a link to set their password is on its way', async () => {
    const { page, add } = await render();

    await add({
      name: ' Abena Owusu ',
      email: 'Abena@example.com',
      calendarEmail: 'abena@gmail.com',
    });

    expect(api.post).toHaveBeenCalledWith('/v1/admins', {
      name: 'Abena Owusu',
      email: 'Abena@example.com',
      calendarEmail: 'abena@gmail.com',
    });
    expect(page.querySelector('h1')?.textContent).toContain('Admin added');
    expect(page.querySelector('[role="status"]')?.textContent).toMatch(
      /Abena Owusu\s+is now an admin\. We've emailed\s+abena@example\.com\s+a link/,
    );
  });

  it('leaves out the calendar email when it is empty, so the Worker uses the login one', async () => {
    const { add } = await render();

    await add({ name: 'Abena Owusu', email: 'abena@example.com', calendarEmail: '  ' });

    expect(api.post).toHaveBeenCalledWith('/v1/admins', {
      name: 'Abena Owusu',
      email: 'abena@example.com',
    });
  });

  it('offers an empty form to add another', async () => {
    const { page, add, fixture } = await render();
    await add({ name: 'Abena Owusu', email: 'abena@example.com' });

    page.querySelector<HTMLButtonElement>('button.primary')!.click();
    await fixture.whenStable();

    expect(page.querySelector('h1')?.textContent).toContain('Add an admin');
    expect(page.querySelector<HTMLInputElement>('#name')!.value).toBe('');
    expect(page.querySelector('#name-error')).toBeNull();
  });

  it('sends nothing without a name or with a bad address', async () => {
    const { page, add } = await render();

    await add({ name: '   ', email: 'not an address', calendarEmail: 'nor this' });

    expect(page.querySelector('#name-error')?.textContent).toContain('Enter their name');
    expect(page.querySelector('#email-hint')?.textContent).toContain('Enter a valid email');
    expect(page.querySelector('#calendar-email-hint')?.textContent).toContain(
      'Enter a valid email',
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('limits the name to what the Worker accepts', async () => {
    const { page } = await render();
    expect(page.querySelector('#name')?.getAttribute('maxlength')).toBe(String(MAX_NAME_LENGTH));
  });

  it('shows the Worker’s reason when it refuses, such as an address already in use', async () => {
    api.post.mockRejectedValue(new ApiError(409, 'That email address already has an account'));
    const { page, add } = await render();

    await add({ name: 'Ama Mensah', email: 'ama@example.com' });

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'That email address already has an account',
    );
    expect(page.querySelector<HTMLInputElement>('#email')!.value).toBe('ama@example.com');
  });

  it('shows no form to anyone but a Primary Admin', async () => {
    for (const role of ['admin', 'member']) {
      api.get.mockResolvedValue({ uid: 'kofi', role });
      const { page } = await render();

      expect(page.querySelector('form')).toBeNull();
      expect(page.textContent).toContain('Only a Primary Admin can add admins');
    }
  });

  it('says why the role could not be checked: unreachable, or the Worker’s reason', async () => {
    for (const message of [
      'Nkabom could not be reached. Check your connection and try again.',
      'Admins log in with email and password',
    ]) {
      api.get.mockRejectedValue(new ApiError(message.startsWith('Nkabom') ? 0 : 403, message));
      const { page } = await render();

      expect(page.querySelector('form')).toBeNull();
      expect(page.textContent).toContain(message);
    }
  });

  it('moves focus to the confirmation, and back to the form to add another', async () => {
    const { page, add, fixture } = await render();
    await add({ name: 'Abena Owusu', email: 'abena@example.com' });
    await fixture.whenStable();
    expect(document.activeElement).toBe(page.querySelector('h1'));

    page.querySelector<HTMLButtonElement>('button.primary')!.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(page.querySelector('#name'));
  });
});
