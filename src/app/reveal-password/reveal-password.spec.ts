import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { RevealPassword } from './reveal-password';

@Component({
  imports: [RevealPassword],
  template: `<input #field type="password" /><app-reveal-password [input]="field" />`,
})
class Host {}

describe('RevealPassword', () => {
  it('shows and hides the password, saying which it will do', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('input')!;
    const button = element.querySelector('button')!;

    expect(button.getAttribute('aria-label')).toBe('Show password');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    await fixture.whenStable();
    expect(input.type).toBe('text');
    expect(button.getAttribute('aria-label')).toBe('Hide password');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    await fixture.whenStable();
    expect(input.type).toBe('password');
  });
});
