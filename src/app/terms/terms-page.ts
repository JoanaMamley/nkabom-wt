import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PRIVACY_CONTACT } from '../privacy/privacy-contact';

/**
 * The terms of service (NKB-212). Public like the privacy notice (FR-1.12), since Meta and Google
 * read it from outside to publish Facebook and Google login, and members can read it before they
 * sign up. The constitution (NKB-701) is for members only and sets the rules of membership; these
 * terms cover only the use of the site. Its contact is the privacy notice's (PRIVACY_CONTACT), and
 * it shares the notice's styles, so the two read as a pair.
 */
@Component({
  selector: 'app-terms-page',
  imports: [RouterLink],
  templateUrl: './terms-page.html',
  styleUrl: '../privacy/privacy-page.scss',
})
export class TermsPage {
  protected readonly contact = inject(PRIVACY_CONTACT);
}
