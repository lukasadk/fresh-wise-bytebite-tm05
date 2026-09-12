import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEnterApp,
  STARTUP_FONT_FAIL_OPEN_MS,
  STARTUP_IDENTITY_FAIL_OPEN_MS,
} from '../src/startup/readiness.ts';

test('does not enter while both local startup gates are still pending', () => {
  assert.equal(canEnterApp({
    fontsLoaded: false,
    fontLoadFailed: false,
    fontDeadlineReached: false,
    deviceReady: false,
  }), false);
});

test('font failure or deadline cannot permanently trap the landing button', () => {
  assert.equal(canEnterApp({
    fontsLoaded: false,
    fontLoadFailed: true,
    fontDeadlineReached: false,
    deviceReady: true,
  }), true);
  assert.equal(canEnterApp({
    fontsLoaded: false,
    fontLoadFailed: false,
    fontDeadlineReached: true,
    deviceReady: true,
  }), true);
});

test('offline startup deadlines stay short and bounded', () => {
  assert.equal(STARTUP_FONT_FAIL_OPEN_MS, 3_000);
  assert.equal(STARTUP_IDENTITY_FAIL_OPEN_MS, 2_000);
});
