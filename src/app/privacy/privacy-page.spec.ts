import { TestBed } from '@angular/core/testing';

import { PRIVACY_CONTACT } from './privacy-contact';
import { PrivacyPage } from './privacy-page';

describe('PrivacyPage', () => {
  async function render(contact: string | null): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [PrivacyPage],
      providers: [{ provide: PRIVACY_CONTACT, useValue: contact }],
    });
    const fixture = TestBed.createComponent(PrivacyPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function section(page: HTMLElement, id: string): string {
    return page.querySelector(`section#${id}`)?.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  it('covers every point in FR-1.14', async () => {
    const page = await render('privacy@example.com');

    // What is collected
    for (const item of ['name', 'date of birth', 'occupation', 'graduat', 'photo']) {
      expect(section(page, 'collected')).toContain(item);
    }
    // Why
    expect(section(page, 'why')).toContain('alumna');
    // Who sees what: admins the full record, members the directory profile
    expect(section(page, 'who-sees')).toContain('full record');
    expect(section(page, 'who-sees')).toContain('directory profile');
    // Birthdays in a calendar only the admins can see, day and month only
    expect(section(page, 'birthdays')).toContain('shared only with the executives');
    expect(section(page, 'birthdays')).toContain('day and month only');
    // How long data is kept
    expect(section(page, 'how-long')).toContain('30 days');
    // Rights to access, correct and delete
    for (const right of ['See your data', 'Correct it', 'Delete it']) {
      expect(section(page, 'rights')).toContain(right);
    }
    // Who to contact
    expect(section(page, 'contact')).toContain('privacy@example.com');
  });

  it('says the data may be stored outside Ghana', async () => {
    const page = await render(null);

    expect(section(page, 'where')).toContain('outside Ghana');
  });

  it('links the contact address as an email', async () => {
    const page = await render('privacy@example.com');

    const link = page.querySelector<HTMLAnchorElement>('#contact a');
    expect(link?.getAttribute('href')).toBe('mailto:privacy@example.com');
  });

  it('points to the executives in a build with no contact address', async () => {
    const page = await render(null);

    expect(page.querySelector('#contact a')).toBeNull();
    expect(section(page, 'contact')).toContain('contact any of the executives');
  });
});
