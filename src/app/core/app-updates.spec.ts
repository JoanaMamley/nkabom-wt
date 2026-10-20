import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, type UnrecoverableStateEvent, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { AppUpdates } from './app-updates';

describe('AppUpdates', () => {
  let versionUpdates: Subject<VersionEvent>;
  let unrecoverable: Subject<UnrecoverableStateEvent>;
  let reload: ReturnType<typeof vi.fn>;

  function setUp(isEnabled = true): AppUpdates {
    versionUpdates = new Subject();
    unrecoverable = new Subject();
    reload = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: { isEnabled, versionUpdates, unrecoverable } },
        { provide: DOCUMENT, useValue: { location: { reload } } },
      ],
    });
    return TestBed.inject(AppUpdates);
  }

  const version = { hash: 'abc' };

  it('is ready once a new version has downloaded', () => {
    const updates = setUp();

    versionUpdates.next({ type: 'VERSION_DETECTED', version });
    expect(updates.ready()).toBe(false);

    versionUpdates.next({ type: 'VERSION_READY', currentVersion: version, latestVersion: version });
    expect(updates.ready()).toBe(true);
  });

  it('stays not ready when a new version fails to install', () => {
    const updates = setUp();

    versionUpdates.next({ type: 'VERSION_INSTALLATION_FAILED', version, error: 'quota' });
    expect(updates.ready()).toBe(false);
  });

  it('reloads when the cached version is broken', () => {
    setUp();

    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'evicted' });
    expect(reload).toHaveBeenCalled();
  });

  it('reloads on request', () => {
    setUp().reload();

    expect(reload).toHaveBeenCalled();
  });

  it('does nothing when the service worker is off, as in development', () => {
    const updates = setUp(false);

    versionUpdates.next({ type: 'VERSION_READY', currentVersion: version, latestVersion: version });
    expect(updates.ready()).toBe(false);
  });
});
