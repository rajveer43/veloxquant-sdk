import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runServe } from '../../src/cli/serve.js';

test('runServe: missing --model exits 1 without starting a server', async () => {
  const code = await runServe({});
  assert.equal(code, 1);
});
