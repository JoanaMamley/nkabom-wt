import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ThemeToggle } from '../theme-toggle/theme-toggle';

/**
 * The split screen around login, sign-up and the email steps: the brand art on one side and the
 * page's form on the other, stacked on phones. Pages using it set fullScreen in their route data,
 * so the app's header and footer make way for it; it carries the theme toggle (FR-8.8) and the
 * privacy notice link (FR-1.13) itself.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterLink, ThemeToggle],
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
})
export class AuthLayout {
  /** The short line under the app name, such as "Log in to your account". */
  readonly tagline = input.required<string>();
}
