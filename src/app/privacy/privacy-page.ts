import { Component, inject } from '@angular/core';

import { PRIVACY_CONTACT } from './privacy-contact';

/**
 * The privacy notice (NKB-201, FR-1.13 to FR-1.15). One of the three pages anyone can see without
 * logging in (FR-1.12). Each section answers one point of FR-1.14; change the text with the
 * requirements, and keep the retention section in step with NKB-707.
 */
@Component({
  selector: 'app-privacy-page',
  templateUrl: './privacy-page.html',
  styleUrl: './privacy-page.scss',
})
export class PrivacyPage {
  protected readonly contact = inject(PRIVACY_CONTACT);
}
