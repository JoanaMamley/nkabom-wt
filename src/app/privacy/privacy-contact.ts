import { InjectionToken } from '@angular/core';

import { environment } from '../../environments/environment';

/** Who to contact about personal data (FR-1.14), or null in a build without one, such as CI's. */
export const PRIVACY_CONTACT = new InjectionToken<string | null>('PRIVACY_CONTACT', {
  providedIn: 'root',
  factory: () => environment.privacyContact || null,
});
