import { Component, input, signal } from '@angular/core';

/**
 * The eye button inside a password field that shows or hides what was typed. Place it in the
 * field's .field.has-reveal wrapper and pass it the input: <app-reveal-password [input]="ref" />.
 */
@Component({
  selector: 'app-reveal-password',
  templateUrl: './reveal-password.html',
  styleUrl: './reveal-password.scss',
})
export class RevealPassword {
  readonly input = input.required<HTMLInputElement>();
  protected readonly shown = signal(false);

  protected toggle(): void {
    this.shown.update((shown) => !shown);
    this.input().type = this.shown() ? 'text' : 'password';
    // Back to the field, so typing carries on where it was.
    this.input().focus();
  }
}
