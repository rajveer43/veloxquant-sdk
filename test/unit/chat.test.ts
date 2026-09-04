import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInstructions, parseResponseFormat } from '../../src/chat.js';

test('formatInstructions: json_object asks for a bare JSON object with no schema', () => {
  const instructions = formatInstructions({ type: 'json_object' });
  assert.match(instructions, /valid JSON object/);
  assert.doesNotMatch(instructions, /JSON Schema/);
});

test('formatInstructions: json_schema embeds the schema', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
  const instructions = formatInstructions({ type: 'json_schema', schema });
  assert.match(instructions, /JSON Schema/);
  assert.match(instructions, /"name"/);
});

test('parseResponseFormat: parses a plain JSON object', () => {
  const result = parseResponseFormat('{"name": "John", "age": 30}');
  assert.deepEqual(result, { name: 'John', age: 30 });
});

test('parseResponseFormat: strips markdown code fences before parsing', () => {
  const result = parseResponseFormat('```json\n{"ok": true}\n```');
  assert.deepEqual(result, { ok: true });
});

test('parseResponseFormat: strips bare fences without a language tag', () => {
  const result = parseResponseFormat('```\n{"ok": true}\n```');
  assert.deepEqual(result, { ok: true });
});

test('parseResponseFormat: throws a descriptive error (not a raw SyntaxError) on invalid JSON', () => {
  assert.throws(
    () => parseResponseFormat('Sure! Here is your answer: not json'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /responseFormat was requested but the model's output could not be parsed as JSON/);
      assert.match(err.message, /Raw output: Sure! Here is your answer: not json/);
      return true;
    },
  );
});
