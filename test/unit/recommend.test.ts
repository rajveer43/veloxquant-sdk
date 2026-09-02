import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_CHIPS, SUPPORTED_RAM_GB, normalizeChip, normalizeRamGb } from '../../src/recommend.js';

test('SUPPORTED_CHIPS matches the installed veloxquant-mlx 0.71.1 argparse choices (no M5)', () => {
  assert.deepEqual(SUPPORTED_CHIPS, ['M1', 'M2', 'M3', 'M4']);
});

test('SUPPORTED_RAM_GB matches the installed veloxquant-mlx 0.71.1 argparse choices (tops out at 128)', () => {
  assert.deepEqual(SUPPORTED_RAM_GB, [8, 16, 24, 32, 36, 48, 64, 128]);
});

test('normalizeChip: maps "Apple M4" to "M4"', () => {
  assert.equal(normalizeChip('Apple M4'), 'M4');
});

test('normalizeChip: maps chip variants with a suffix (Pro/Max) to their base tier', () => {
  assert.equal(normalizeChip('Apple M4 Pro'), 'M4');
  assert.equal(normalizeChip('Apple M3 Max'), 'M3');
});

test('normalizeChip: throws on null (no chip detected)', () => {
  assert.throws(() => normalizeChip(null), /Could not detect an Apple Silicon chip/);
});

test('normalizeChip: throws on an unsupported chip (e.g. M5, not yet in SUPPORTED_CHIPS)', () => {
  assert.throws(() => normalizeChip('Apple M5'), /not one of the chips veloxquant recommend supports/);
});

test('normalizeChip: throws on a non-Apple-Silicon chip string', () => {
  assert.throws(() => normalizeChip('Intel(R) Core(TM) i7-9750H'), /not one of the chips veloxquant recommend supports/);
});

test('normalizeRamGb: rounds down to the nearest supported tier', () => {
  const twentyGb = 20 * 1024 ** 3;
  assert.equal(normalizeRamGb(twentyGb), 16);
});

test('normalizeRamGb: exact tier matches stay exact', () => {
  const twentyFourGb = 24 * 1024 ** 3;
  assert.equal(normalizeRamGb(twentyFourGb), 24);
});

test('normalizeRamGb: never rounds up, even when very close to the next tier', () => {
  const justUnder32Gb = 31.9 * 1024 ** 3;
  assert.equal(normalizeRamGb(justUnder32Gb), 24);
});

test('normalizeRamGb: throws when below the smallest supported tier', () => {
  const fourGb = 4 * 1024 ** 3;
  assert.throws(() => normalizeRamGb(fourGb), /below the smallest tier/);
});

test('normalizeRamGb: throws on null (no memory detected)', () => {
  assert.throws(() => normalizeRamGb(null), /Could not detect unified memory/);
});
