import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInterpreter } from '../../src/python/interpreter.js';

test('resolveInterpreter: explicit path wins over everything', () => {
  const result = resolveInterpreter('/opt/homebrew/bin/python3.12');
  assert.equal(result.path, '/opt/homebrew/bin/python3.12');
  assert.equal(result.source, 'explicit');
});

test('resolveInterpreter: falls back to VELOXQUANT_PYTHON env var', () => {
  const prev = process.env.VELOXQUANT_PYTHON;
  process.env.VELOXQUANT_PYTHON = '/usr/bin/python3';
  try {
    const result = resolveInterpreter();
    assert.equal(result.path, '/usr/bin/python3');
    assert.equal(result.source, 'env');
  } finally {
    if (prev === undefined) delete process.env.VELOXQUANT_PYTHON;
    else process.env.VELOXQUANT_PYTHON = prev;
  }
});

test('resolveInterpreter: defaults to python3 on PATH', () => {
  const prev = process.env.VELOXQUANT_PYTHON;
  delete process.env.VELOXQUANT_PYTHON;
  try {
    const result = resolveInterpreter();
    assert.equal(result.path, 'python3');
    assert.equal(result.source, 'default');
  } finally {
    if (prev !== undefined) process.env.VELOXQUANT_PYTHON = prev;
  }
});
