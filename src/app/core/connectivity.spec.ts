import { TestBed } from '@angular/core/testing';

import { Connectivity } from './connectivity';

describe('Connectivity', () => {
  it('starts from the browser’s current state and follows online and offline events', () => {
    const connectivity = TestBed.inject(Connectivity);
    expect(connectivity.online()).toBe(navigator.onLine);

    window.dispatchEvent(new Event('offline'));
    expect(connectivity.online()).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(connectivity.online()).toBe(true);
  });
});
