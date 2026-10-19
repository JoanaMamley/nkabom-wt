import { TestBed } from '@angular/core/testing';

import { FIRESTORE_LOADER, provideFirebase } from './firebase';

describe('provideFirebase', () => {
  it('loads Firestore on first use and reuses one instance', async () => {
    TestBed.configureTestingModule({ providers: [provideFirebase()] });
    const loadFirestore = TestBed.inject(FIRESTORE_LOADER);

    const [first, second] = await Promise.all([loadFirestore(), loadFirestore()]);

    expect(first).toBe(second);
    expect(first.app.options.projectId).toBe('demo-nkabom');
  });
});
