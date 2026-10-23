import { describe, expect, it } from 'vitest';

import { decodeFields } from './firestore';

describe('decodeFields', () => {
  it('turns Firestore values into plain values', () => {
    expect(
      decodeFields({
        role: { stringValue: 'member' },
        active: { booleanValue: true },
        year: { integerValue: '2019' },
        score: { doubleValue: 4.5 },
        removed: { nullValue: null },
        createdAt: { timestampValue: '2026-10-23T08:00:00Z' },
        courses: { arrayValue: { values: [{ stringValue: 'Nursing' }] } },
        none: { arrayValue: {} },
        address: { mapValue: { fields: { city: { stringValue: 'Accra' } } } },
      }),
    ).toEqual({
      role: 'member',
      active: true,
      year: 2019,
      score: 4.5,
      removed: null,
      createdAt: new Date('2026-10-23T08:00:00Z'),
      courses: ['Nursing'],
      none: [],
      address: { city: 'Accra' },
    });
  });
});
