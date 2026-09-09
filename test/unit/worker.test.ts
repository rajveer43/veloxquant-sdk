import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeWorkerResponse } from '../../src/python/worker.js';

test('worker protocol decodes successful responses', () => {
  assert.deepEqual(decodeWorkerResponse('{"protocol_version":1,"id":"r1","ok":true,"result":{"version":"0.80.0"}}'), {
    protocol_version: 1, id: 'r1', ok: true, result: { version: '0.80.0' },
  });
});

test('worker protocol preserves structured errors', () => {
  assert.deepEqual(decodeWorkerResponse('{"protocol_version":1,"id":"r2","ok":false,"error":"unknown worker operation"}'), {
    protocol_version: 1, id: 'r2', ok: false, error: 'unknown worker operation',
  });
});

test('worker protocol rejects malformed envelopes', () => {
  assert.throws(() => decodeWorkerResponse('{"protocol_version":1,"id":"r3"}'), /invalid veloxquant worker response/);
  assert.throws(() => decodeWorkerResponse('not-json'), SyntaxError);
});
