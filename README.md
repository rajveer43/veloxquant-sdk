<div align="center">

<img src="media/icon.png" width="96" height="96" alt="VeloxQuant logo">

# @veloxquant/sdk

<p>
  <a href="https://www.npmjs.com/package/@veloxquant/sdk"><img src="https://img.shields.io/npm/v/%40veloxquant%2Fsdk?style=flat-square&logo=npm&logoColor=white&color=cb3837" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@veloxquant/sdk"><img src="https://img.shields.io/npm/dm/%40veloxquant%2Fsdk?style=flat-square&logo=npm&logoColor=white&color=cb3837" alt="npm downloads"/></a>
  <img src="https://img.shields.io/badge/platform-Apple%20Silicon%20M1+-black?style=flat-square&logo=apple&logoColor=white" alt="Platform"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="License"/></a>
</p>

</div>

The JavaScript/TypeScript SDK for [VeloxQuant-MLX](https://pypi.org/project/veloxquant-mlx/):
hardware-aware KV-cache memory optimization and OpenAI-compatible local
inference on Apple Silicon, without writing Python.

Part of the VeloxQuant ecosystem:

```
VeloxQuant-MLX (Python engine)  ──┐
                                   ├──►  @veloxquant/sdk (this package)
VeloxQuant VS Code extension    ──┘            │
                                                ▼
                                    VeloxQuant Studio (macOS app)
```

This SDK does not reimplement quantization or hardware detection — it is a
typed bridge that shells out to the `veloxquant` CLI and talks HTTP to a
`veloxquant serve` process it manages for you.

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

## Hardware-aware memory optimization

```ts
const info = await vq.system.info();
// { chip: "Apple M4", unifiedMemoryBytes: ..., veloxquantVersion: "0.71.1", ... }

const estimate = await vq.memory.estimate({ seqLen: 32768, headDim: 128, nLayers: 32 });
// { fp16KvCacheBytes, recommendedMethod, estimatedCompressedBytes, memorySavedBytes, reason }

const picked = await vq.optimize({ profile: "maximum-context", seqLen: 32768 });
// picks a method/bit-width biased toward the long-context band
```

Loading a model with automatic optimization keeps the server process alive
across multiple turns instead of spinning one up per call:

```ts
const model = await vq.load({ model: "mlx-community/Qwen3-8B-4bit", optimize: "auto" });
const r1 = await model.chat({ prompt: "Hi" });
const r2 = await model.chat({ prompt: "Now summarize that" });
await model.stop();
```

## CLI

```bash
npx veloxquant doctor      # checks Apple Silicon + veloxquant-mlx install
npx veloxquant recommend   # shows detected hardware + servable methods
npx veloxquant analyze --seq-len 32768 --head-dim 128 --n-layers 32
```

## What v0.1 does and does not cover

`veloxquant-mlx`'s `recommend` CLI (chip/RAM/model-class picker) and
`auto-config` (workload/hardware → method picker) are two independent
selectors in the underlying package — this SDK exposes both
(`vq.recommendModel()` and `vq.memory` / `vq.optimize()`) rather than
merging them, since the package itself doesn't merge them either.

Compression byte counts reported by `veloxquant-mlx` are accounting-only
today: caches store dequantized fp16 tensors, so byte counters measure
compression fidelity, not runtime memory actually freed. `memory.estimate()`
surfaces this as `estimatedCompressedBytes` / `memorySavedBytes` — treat
them as directional, not a guarantee, until the package changes this (see
veloxquant-mlx issue #27).

`vq.recommendModel()`'s `chip`/`ramGb` inputs are constrained to what the
installed `veloxquant recommend` CLI actually accepts (`SUPPORTED_CHIPS`,
`SUPPORTED_RAM_GB` exported from this package) — M1-M4 and RAM up to 128GB
as of veloxquant-mlx 0.71.1. Passing values outside that set fails with the
CLI's own argparse error rather than being silently widened.

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
