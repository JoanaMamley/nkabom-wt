import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PRIVACY_CONTACT } from '../privacy/privacy-contact';
import { TermsPage } from './terms-page';

describe('TermsPage', () => {
  async function render(contact: string | null): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [TermsPage],
      providers: [provideRouter([]), { provide: PRIVACY_CONTACT, useValue: contact }],
    });
    const fixture = TestBed.createComponent(TermsPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function section(page: HTMLElement, id: string): string {
    return page.querySelector(`section#${id}`)?.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  it('covers what NKB-212 asks of the terms', async () => {
    const page = await render('privacy@example.com');

    expect(section(page, 'who-runs')).toContain('WomenTrust Graduate Association');
    expect(section(page, 'who-can-join')).toContain('WomenTrust alumnae');
    expect(section(page, 'who-can-join')).toContain('one account');
    expect(section(page, 'using')).toContain('respect');
    expect(section(page, 'constitution')).toContain('constitution');
    expect(section(page, 'ending')).toContain('suspend or remove');
    expect(section(page, 'free')).toContain('free');
    expect(section(page, 'contact')).toContain('privacy@example.com');
  });

  it('links to the privacy notice, and to its rights section for deletion', async () => {
    const page = await render(null);

    const links = [...page.querySelectorAll<HTMLAnchorElement>('a[href^="/privacy"]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toEqual(['/privacy', '/privacy#rights']);
  });

  it('links the contact address as an email', async () => {
    const page = await render('privacy@example.com');

    expect(page.querySelector('#contact a')?.getAttribute('href')).toBe(
      'mailto:privacy@example.com',
    );
  });

  it('points to the executives in a build with no contact address', async () => {
    const page = await render(null);

    expect(section(page, 'contact')).toContain('contact any of the executives');
  });
});
