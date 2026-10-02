import assert from 'node:assert/strict';
import test from 'node:test';

import { preferPrintedExpiry } from '../src/vlm/expiryPriority.ts';

test('printed expiry clears every estimate field', () => {
  assert.deepEqual(
    preferPrintedExpiry('2026-10-06', '2026-10-12', 10, 'fresh poultry estimate'),
    {
      estimatedExpiryDate: null,
      expiryEstimateDays: null,
      expiryEstimateBasis: null,
    },
  );
});

test('estimate remains available only when no printed expiry exists', () => {
  assert.deepEqual(
    preferPrintedExpiry(null, '2026-10-12', 10, 'fresh poultry estimate'),
    {
      estimatedExpiryDate: '2026-10-12',
      expiryEstimateDays: 10,
      expiryEstimateBasis: 'fresh poultry estimate',
    },
  );
});
