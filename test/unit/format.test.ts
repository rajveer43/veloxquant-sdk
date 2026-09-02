import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, check } from '../../src/cli/format.js';

test('formatBytes: null is unknown', () => {
  assert.equal(formatBytes(null), 'unknown');
});

test('formatBytes: sub-GB values render in MB', () => {
  assert.equal(formatBytes(512 * 1024 ** 2), '512 MB');
});

test('formatBytes: GB-scale values render in GB with one decimal', () => {
  assert.equal(formatBytes(9.2 * 1024 ** 3), '9.2 GB');
});

test('check: renders a checkmark or cross', () => {
  assert.equal(check(true), '✓');
  assert.equal(check(false), '✗');
});
