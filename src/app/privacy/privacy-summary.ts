import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The one-line summary of the privacy notice for the sign-up page (FR-1.15), placed there by
 * NKB-202. Consent itself is recorded on the registration form after login (FR-2.7, NKB-303).
 */
@Component({
  selector: 'app-privacy-summary',
  imports: [RouterLink],
  templateUrl: './privacy-summary.html',
  styleUrl: './privacy-summary.scss',
})
export class PrivacySummary {}
