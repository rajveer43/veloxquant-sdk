<div align="center">

<img src="media/icon.png" width="96" height="96" alt="VeloxQuant logo">

# @veloxquant/sdk

<p>
  <a href="https://www.npmjs.com/package/@veloxquant/sdk"><img src="https://img.shields.io/npm/v/%40veloxquant%2Fsdk?style=flat-square&logo=npm&logoColor=white&color=cb3837" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@veloxquant/sdk"><img src="https://img.shields.io/npm/dm/%40veloxquant%2Fsdk?style=flat-square&logo=npm&logoColor=white&color=cb3837" alt="npm downloads"/></a>
  <img src="https://img.shields.io/badge/platform-Apple%20Silicon%20M1+-black?style=flat-square&logo=apple&logoColor=white" alt="Platform"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="License"/></a>
</p>

**The JavaScript/TypeScript SDK for [VeloxQuant-MLX](https://pypi.org/project/veloxquant-mlx/).**
Hardware-aware KV-cache memory optimization and OpenAI-compatible local
inference on Apple Silicon — without writing Python.

</div>

## Overview

`@veloxquant/sdk` is a typed bridge, not a reimplementation: it shells out to
the `veloxquant` CLI and talks HTTP to a `veloxquant serve` process that it
manages for you, so quantization and hardware detection stay the
responsibility of the underlying `veloxquant-mlx` engine.

## Contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Streaming](#streaming)
- [Autopilot](#autopilot)
- [Memory calculator](#memory-calculator)
- [Compression methods](#compression-methods)
- [OpenAI compatibility](#openai-compatibility)
- [Hardware-aware memory optimization](#hardware-aware-memory-optimization)
- [Persistent model sessions](#persistent-model-sessions)
- [Benchmarking](#benchmarking)
- [CLI](#cli)
- [Known limitations](#known-limitations)
- [Development](#development)
- [License](#license)

## Requirements

- macOS on Apple Silicon (M1 or later) — MLX has no other backend.
- Python 3.10+ with `veloxquant-mlx` installed (`pip install veloxquant-mlx`).
- Node.js 18.17+.

## Install

```bash
npm install @veloxquant/sdk
```

## Quick start

```ts
import { VeloxQuant } from "@veloxquant/sdk";

const vq = new VeloxQuant();

const response = await vq.chat({
  model: "mlx-community/Qwen3-8B-4bit",
  messages: [{ role: "user", content: "Explain quantum computing simply." }],
});

console.log(response.text);
```

## Streaming

```ts
for await (const chunk of vq.stream({
  model: "mlx-community/Qwen3-4B-4bit",
  prompt: "Explain transformers",
})) {
  if (!chunk.done) process.stdout.write(chunk.text);
}
```

## Autopilot

`autopilot()` is the zero-config entry point for "I don't want to think about
memory." Give it a model and a rough model-size class; it gets a
hardware-aware recommendation for this machine, refuses to start a server for
a configuration that clearly won't fit, and loads the model with a method
`veloxquant serve` can actually run:

```ts
import { autopilot } from "@veloxquant/sdk";

const ai = await autopilot({ model: "mlx-community/Llama-3.2-1B-Instruct-4bit", modelClass: "1B" });
const answer = await ai.chat({ prompt: "Build a REST API in TypeScript" });
await ai.stop();
```

If the recommended configuration is unlikely to fit in available memory,
`autopilot()` throws an `AutopilotFitError` describing why instead of starting
a server that would likely crash or thrash:

```ts
try {
  await autopilot({ model: "mlx-community/Qwen3-32B-4bit", modelClass: "32B" });
} catch (err) {
  if (err instanceof AutopilotFitError) {
    console.error(err.message); // lists the specific won't-fit warning(s)
  }
}
```

Pass `{ force: true }` to start the server anyway. Note: `autopilot()` does
not pick a model for you — `veloxquant-mlx` has no LLM catalog to select
from, only a KV-cache compression config recommender — `model` must always be
a model you name yourself.

## Memory calculator

`vq.memory.estimate()` answers "will this fit?" for a given attention shape —
fp16 KV-cache size, the compression method `veloxquant-mlx` would pick, and a
directional estimate of what compression saves:

```ts
import { VeloxQuant, formatBytes } from "@veloxquant/sdk";

const vq = new VeloxQuant();
const estimate = await vq.memory.estimate({ seqLen: 32768, headDim: 128, nLayers: 32 });

console.log(`fp16 KV-cache:        ${formatBytes(estimate.fp16KvCacheBytes)}`);
console.log(`Recommended method:   ${estimate.recommendedMethod}`);
console.log(`Estimated compressed: ${formatBytes(estimate.estimatedCompressedBytes)}`);
console.log(`Estimated saved:      ${formatBytes(estimate.memorySavedBytes)}`);
```

```txt
fp16 KV-cache:        512 MB
Recommended method:   kvquant
Estimated compressed: 96 MB
Estimated saved:      416 MB
```

(Real output from `examples/memory-estimate.ts --seq-len 32768 --head-dim 128 --n-layers 32`
against veloxquant-mlx 0.71.1 — the method and savings above depend on the
installed package version and the workload shape you pass in.)

A standalone, copy-pasteable version of this lives at
[`examples/memory-estimate.ts`](examples/memory-estimate.ts):

```bash
npx tsx examples/memory-estimate.ts --seq-len 32768 --head-dim 128 --n-layers 32
```

The same caveat from [Known limitations](#known-limitations) applies here:
these byte counts are accounting-only (fidelity estimates), not measured
runtime memory freed.

## Compression methods

`vq.models.list()` — despite the name, this lists `veloxquant-mlx`'s KV-cache
**compression methods**, not LLMs (the package has no model catalog; see the
[Overview](#overview)). Use it to discover what's available and which methods
`veloxquant serve` can actually run:

```ts
const methods = await vq.models.list({ servableOnly: true });
console.log(`Default serve method: ${methods.defaultServeMethod}`);
for (const m of methods.methods.slice(0, 5)) {
  console.log(`${m.name.padEnd(16)} ${m.family.padEnd(12)} ${m.serveTierLabel}`);
}
```

```txt
Default serve method: turboquant_rvq

a2ats            hybrid       available
adakv            quantization available
age_tiered       quantization available (no prompt-cache trimming)
amc              eviction     available (no prompt-cache trimming)
anchorkv         hybrid       available (no prompt-cache trimming)
```

(Real output from veloxquant-mlx 0.71.1 — 43 methods total as of this
version.) Filter by family with `vq.models.list({ family: "quantization" })`;
valid families are `"quantization"`, `"eviction"`, and `"hybrid"`.

Every method's byte-count reporting is accounting-only — see
[Known limitations](#known-limitations) — which is also why
`methods.accountingNote` is included directly in the result rather than left
for callers to discover separately.

## Hardware-aware memory optimization

```ts
const info = await vq.system.info();
// { chip: "Apple M4", unifiedMemoryBytes: ..., veloxquantVersion: "0.71.1", ... }

const estimate = await vq.memory.estimate({ seqLen: 32768, headDim: 128, nLayers: 32 });
// { fp16KvCacheBytes, recommendedMethod, estimatedCompressedBytes, memorySavedBytes, reason }

const picked = await vq.optimize({ profile: "maximum-context", seqLen: 32768 });
// picks a method/bit-width biased toward the long-context band

const recommendation = await vq.recommendModel({ modelClass: "7B", goal: "max_context" });
// chip/ramGb auto-detected from this machine when omitted — pass them explicitly to override
```

## Persistent model sessions

Loading a model with automatic optimization keeps the server process alive
across multiple turns instead of spinning one up per call:

```ts
const model = await vq.load({ model: "mlx-community/Qwen3-8B-4bit", optimize: "auto" });
const r1 = await model.chat({ prompt: "Hi" });
const r2 = await model.chat({ prompt: "Now summarize that" });
await model.stop();
```

## Benchmarking

`vq.benchmark()` measures tokens/sec, time-to-first-token, and resident
memory (RSS) for a model on this machine — real numbers from your own
hardware, not a README claim:

```ts
import { VeloxQuant } from "@veloxquant/sdk";

const vq = new VeloxQuant();
const result = await vq.benchmark({ model: "mlx-community/Llama-3.2-1B-Instruct-4bit" });

console.log(result.toMarkdown());
```

```txt
VeloxQuant Benchmark

Model: mlx-community/Llama-3.2-1B-Instruct-4bit
Machine: Apple M4
RAM: 24GB

Tokens/sec: 124.8
TTFT: 237ms

turboquant_rvq resident memory: 1055MB
kivi resident memory: 1052MB
Resident memory reduced: 0%
```

(Real output from a local run — requires real Apple Silicon hardware and the
model already downloaded; there's no way to run this in CI.)

Tokens/sec and TTFT are measured at the SDK boundary from `stream()` chunk
timestamps. The resident-memory numbers are genuine measured RSS of the
`veloxquant serve` subprocess (via `ps`) — **not** the accounting-only byte
counts `vq.memory.estimate()` reports (see
[Known limitations](#known-limitations)). Because of that, compression is
not guaranteed to reduce measured RSS: `toMarkdown()` reports an increase
honestly rather than hiding it, since idle RSS mostly reflects model
weights, and KV-cache compression's effect is small or even negative for a
short prompt against a small model — measured directly against
`Llama-3.2-1B-Instruct-4bit` above.

## OpenAI compatibility

A server started with `vq.load()` already speaks the OpenAI chat-completions
API — this SDK's own `chat()`/`stream()` post directly to
`${baseUrl}/v1/chat/completions`. That means the real
[`openai`](https://www.npmjs.com/package/openai) npm package works against it
directly, with no wrapper class:

```ts
import OpenAI from "openai";
import { VeloxQuant } from "@veloxquant/sdk";

const vq = new VeloxQuant();
const model = await vq.load({ model: "mlx-community/Llama-3.2-1B-Instruct-4bit", optimize: "auto" });

const client = new OpenAI({ baseURL: `${model.baseUrl}/v1`, apiKey: "local" });
const response = await client.chat.completions.create({
  model: "mlx-community/Llama-3.2-1B-Instruct-4bit", // the served model id, not model.method
  messages: [{ role: "user", content: "Hello" }],
});
```

Two things to get right, both verified against a real running server:

- **`baseURL` must include `/v1`** — the `openai` client appends
  `/chat/completions` itself.
- **`model` in the request must be the actual served model id**, not
  `model.method` (that's the KV-cache compression method name, e.g. `"kivi"`
  — passing it as `model` is rejected with a 404, since the server is pinned
  to one model per process and treats `model` as a routing check, not a free
  label).

A full runnable version (including streaming) is at
[`examples/openai-client.ts`](examples/openai-client.ts). `openai` is not a
dependency of this package — install it yourself if you want to use it this
way.

## CLI

```bash
npx veloxquant doctor      # checks Apple Silicon + veloxquant-mlx install
npx veloxquant recommend   # shows detected hardware + servable methods
npx veloxquant recommend --model-class 7B --goal everyday  # full recommendation (chip/RAM auto-detected)
npx veloxquant analyze --seq-len 32768 --head-dim 128 --n-layers 32
```

Every command accepts `--json` for scripting/CI use — valid, parseable JSON on
stdout with nothing else mixed in:

```bash
npx veloxquant doctor --json
```

```json
{
  "ready": true,
  "platform": { "ok": true, "value": "darwin" },
  "appleSilicon": { "ok": true, "chip": "Apple M4" },
  "python": { "ok": true, "interpreter": "python3" },
  "veloxquantMlx": { "ok": true, "version": "0.70.0" }
}
```

(Real output, verified against a local machine.)

## Known limitations

**`recommend` vs. `auto-config` stay separate.** `veloxquant-mlx`'s
`recommend` CLI (chip/RAM/model-class picker) and `auto-config`
(workload/hardware → method picker) are two independent selectors in the
underlying package — this SDK exposes both (`vq.recommendModel()` and
`vq.memory` / `vq.optimize()`) rather than merging them, since the package
itself doesn't merge them either.

**Compression byte counts are accounting-only.** Caches store dequantized
fp16 tensors today, so byte counters measure compression fidelity, not
runtime memory actually freed. `memory.estimate()` surfaces this as
`estimatedCompressedBytes` / `memorySavedBytes` — treat them as directional,
not a guarantee, until the package changes this (see veloxquant-mlx issue
#27).

**`recommendModel()` inputs are constrained to what's installed.**
`chip`/`ramGb` are validated against whatever the installed `veloxquant
recommend` CLI actually accepts (`SUPPORTED_CHIPS`, `SUPPORTED_RAM_GB`
exported from this package) — M1-M4 and RAM up to 128GB as of
veloxquant-mlx 0.71.1. Passing values outside that set fails with the CLI's
own argparse error rather than being silently widened.

## Development

```bash
npm install
npm run build       # tsup -> dist/
npm test            # node --test against test/unit
npm run typecheck
npm run lint
```

## License

MIT
</content>
