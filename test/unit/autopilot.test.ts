import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WONT_FIT_PATTERN, extractBitWidth, AutopilotFitError } from '../../src/autopilot.js';

test('WONT_FIT_PATTERN: matches real "will not fit" warning prose from veloxquant recommend', () => {
  const warning =
    'A 32B model will not fit in 8 GB. Its weights alone need ~18.0 GB, which is more than ' +
    'this Mac has once macOS takes its share — you are about 14.0 GB short of any headroom. ' +
    'Pick a smaller model.';
  assert.equal(WONT_FIT_PATTERN.test(warning), true);
});

test('WONT_FIT_PATTERN: does not match routine accounting-only caveats', () => {
  const warning =
    'This method measures smaller but may not free much actual RAM on short prompts, ' +
    'because its default path unpacks values back to full precision as it reads them.';
  assert.equal(WONT_FIT_PATTERN.test(warning), false);
});

test('WONT_FIT_PATTERN: does not match a routine slower-chip caveat', () => {
  const warning =
    'A 14B model on an M2 will generate text more slowly than on a newer chip. Whether it ' +
    'fits at all, though, comes down to how much RAM you have rather than which chip it is.';
  assert.equal(WONT_FIT_PATTERN.test(warning), false);
});

test('extractBitWidth: reads bit_width_inlier when present', () => {
  assert.equal(extractBitWidth({ bit_width_inlier: 1, seed: 42 }), 1);
});

test('extractBitWidth: falls back through the known knob names in order', () => {
  assert.equal(extractBitWidth({ kvquant_bits: 3 }), 3);
  assert.equal(extractBitWidth({ gear_bits: 4 }), 4);
  assert.equal(extractBitWidth({ kivi_bits: 2 }), 2);
});

test('extractBitWidth: returns undefined when no known bit-width knob is present', () => {
  assert.equal(extractBitWidth({ note: 0 }), undefined);
});

test('AutopilotFitError: message lists each won\'t-fit warning and mentions force:true', () => {
  const err = new AutopilotFitError(['A 32B model will not fit in 8 GB.']);
  assert.match(err.message, /A 32B model will not fit in 8 GB\./);
  assert.match(err.message, /force: true/);
  assert.equal(err.name, 'AutopilotFitError');
});
