import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PrivacySummary } from './privacy-summary';

describe('PrivacySummary', () => {
  it('sums up the notice in one line and links to it (FR-1.15)', async () => {
    TestBed.configureTestingModule({ imports: [PrivacySummary], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PrivacySummary);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('p')).toHaveLength(1);
    expect(element.textContent).toContain('other members see only');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/privacy');
  });
});
