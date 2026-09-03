import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown } from '../../src/benchmark.js';

const BASE = {
  model: 'mlx-community/Qwen3-8B-4bit',
  chip: 'Apple M4',
  unifiedMemoryBytes: 24 * 1024 ** 3,
  tokensPerSecond: 42.3,
  timeToFirstTokenMs: 180.4,
  method: 'turboquant_rvq',
  optimizedMethodUsed: 'kivi',
};

test('buildMarkdown: includes model, machine, RAM, tokens/sec, and TTFT', () => {
  const md = buildMarkdown({ ...BASE, defaultMethodResidentBytes: null, optimizedResidentBytes: null });
  assert.match(md, /VeloxQuant Benchmark/);
  assert.match(md, /Model: mlx-community\/Qwen3-8B-4bit/);
  assert.match(md, /Machine: Apple M4/);
  assert.match(md, /RAM: 24GB/);
  assert.match(md, /Tokens\/sec: 42\.3/);
  assert.match(md, /TTFT: 180ms/);
});

test('buildMarkdown: omits memory lines when RSS could not be measured', () => {
  const md = buildMarkdown({ ...BASE, defaultMethodResidentBytes: null, optimizedResidentBytes: null });
  assert.doesNotMatch(md, /resident memory/);
});

test('buildMarkdown: reports a reduction when optimized RSS is lower', () => {
  const md = buildMarkdown({
    ...BASE,
    defaultMethodResidentBytes: 1024 ** 3, // 1024 MB
    optimizedResidentBytes: 512 * 1024 ** 2, // 512 MB
  });
  assert.match(md, /turboquant_rvq resident memory: 1024MB/);
  assert.match(md, /kivi resident memory: 512MB/);
  assert.match(md, /Resident memory reduced: 50%/);
});

test('buildMarkdown: reports an increase (not a fabricated reduction) when optimized RSS is higher', () => {
  const md = buildMarkdown({
    ...BASE,
    defaultMethodResidentBytes: 512 * 1024 ** 2,
    optimizedResidentBytes: 1024 ** 3,
  });
  assert.match(md, /Resident memory increased: 100% \(compression is accounting-only/);
});

test('buildMarkdown: omits the RAM line when unifiedMemoryBytes is null', () => {
  const md = buildMarkdown({
    ...BASE,
    unifiedMemoryBytes: null,
    defaultMethodResidentBytes: null,
    optimizedResidentBytes: null,
  });
  assert.doesNotMatch(md, /RAM:/);
});
