import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_CHIPS, SUPPORTED_RAM_GB } from '../../src/recommend.js';

test('SUPPORTED_CHIPS matches the installed veloxquant-mlx 0.71.1 argparse choices (no M5)', () => {
  assert.deepEqual(SUPPORTED_CHIPS, ['M1', 'M2', 'M3', 'M4']);
});

test('SUPPORTED_RAM_GB matches the installed veloxquant-mlx 0.71.1 argparse choices (tops out at 128)', () => {
  assert.deepEqual(SUPPORTED_RAM_GB, [8, 16, 24, 32, 36, 48, 64, 128]);
});
