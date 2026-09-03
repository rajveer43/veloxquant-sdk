import { test } from 'node:test';
import assert from 'node:assert/strict';
import { veloxquant } from '../../src/ai-sdk.js';
import type { VeloxQuantModel } from '../../src/client.js';

function fakeModel(overrides: Partial<VeloxQuantModel> = {}): VeloxQuantModel {
  return {
    baseUrl: 'http://127.0.0.1:12345',
    model: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
    method: 'turboquant_rvq',
    pid: 1234,
    ...overrides,
  } as VeloxQuantModel;
}

test('veloxquant(): returns a LanguageModelV4-shaped object (has doGenerate/doStream)', () => {
  const languageModel = veloxquant(fakeModel());
  assert.equal(typeof (languageModel as { doGenerate?: unknown }).doGenerate, 'function');
  assert.equal(typeof (languageModel as { doStream?: unknown }).doStream, 'function');
});

test('veloxquant(): uses model.model (the served model id) as the model id, not model.method', () => {
  const languageModel = veloxquant(fakeModel());
  assert.equal((languageModel as { modelId: string }).modelId, 'mlx-community/Llama-3.2-1B-Instruct-4bit');
});

test('veloxquant(): different VeloxQuantModel instances produce independently configured providers', () => {
  const a = veloxquant(fakeModel({ baseUrl: 'http://127.0.0.1:1', model: 'model-a' }));
  const b = veloxquant(fakeModel({ baseUrl: 'http://127.0.0.1:2', model: 'model-b' }));
  assert.notEqual((a as { modelId: string }).modelId, (b as { modelId: string }).modelId);
});
