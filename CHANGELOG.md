# @veloxquant/sdk

## 0.7.1

### Patch Changes

- Add `AbortSignal` support to chat streams, completions, and agent runs so callers can cancel generation without stopping the loaded model.

## 0.7.0

### Minor Changes

- [#36](https://github.com/rajveer43/veloxquant-sdk/pull/36) [`d2b5ff7`](https://github.com/rajveer43/veloxquant-sdk/commit/d2b5ff7eb59fcc669a33752392854462adad94f3) Thanks [@rajveer43](https://github.com/rajveer43)! - Add a persistent MLX/Metal worker bridge (`VeloxQuantWorker`) for Node.js. Exposes `ping()`,
  `capabilities()`, `metalProbe()`, `bitPack()`, `bitPackFile()`, and `ropeRecodeFile()` over a
  long-lived JSON-lines subprocess, with `.npy` file-backed tensor transport for large arrays.

## History (pre-automation)

Versions below were released manually before this repo adopted
[Changesets](https://github.com/changesets/changesets) for automated versioning and release notes.
See git history for full details of each release.

### 0.6.0

- Add LlamaIndex.TS adapter (`@veloxquant/sdk/llamaindex`)
- Add MCP tool sources to Agent (`Agent.useMcpServer`)
- Add `vq.models.pull()` and `vq.models.delete()` for local cache management

### 0.5.0

- Add LangChain.js adapter (`@veloxquant/sdk/langchain`)
- Add real token streaming to the LangChain.js adapter
- Add `vq serve`: standalone CLI command for a persistent local server

### 0.4.0

- Add structured output / JSON mode (`responseFormat`)
- Add `model.conversation()` and `vq.models.local()`

### 0.3.0

- Add Vercel AI SDK provider adapter (`@veloxquant/sdk/ai-sdk`)
- Add single-turn tool-calling agent (`vq.agent()`)

### 0.2.0

- Add `vq.benchmark()`: tokens/sec, TTFT, and measured resident memory
- Auto-detect chip/ramGb in `recommendModel()` from `system.info()`

### 0.1.0

- Initial release of `@veloxquant/sdk`

<!-- Entries below this line are generated automatically by `changeset version`. -->
