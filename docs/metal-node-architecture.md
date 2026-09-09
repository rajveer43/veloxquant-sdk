# MLX/Metal access from Node.js

This document records the investigation for [issue #28](https://github.com/rajveer43/veloxquant-sdk/issues/28).

## Finding

The supported architecture for `@veloxquant/sdk` is a Python/MLX worker boundary, not a direct Node.js Metal addon.

The kernels in `VeloxQuant-MLX` are not shipped as independently compiled Metal libraries. The Python implementation reads `.metal` source and passes it to `mx.fast.metal_kernel`, which JIT-compiles and dispatches the kernel through MLX. The Python layer also owns MLX arrays, stream/evaluation semantics, shape metadata, dtype conversion, and cache integration.

Therefore, copying the `.metal` files into the npm package would not provide a usable runtime. A direct addon would need to replace the MLX execution layer and define a new tensor ABI in addition to exposing Metal command encoding.

## Options considered

| Option | Result | Recommendation |
| --- | --- | --- |
| Python subprocess | Reuses the existing MLX/Metal implementation; works with the current interpreter resolution and server lifecycle | **Supported now** |
| Local HTTP/IPC worker | Keeps a long-lived Python process and avoids per-call startup; can later support shared-memory transport | **Preferred for high-throughput APIs** |
| Node-API native addon | ABI-stable only when using Node-API; MLX and any external native libraries still need their own ABI/distribution guarantees | Research only |
| Swift bridge | Can call Metal directly, but still requires a new tensor and cache ABI; adds Swift binary packaging and signing complexity | Research only |
| Direct Metal from TypeScript | Not possible; TypeScript cannot create Metal command encoders or manage GPU buffers | Reject |

## Why a direct addon is not the first implementation

1. **MLX is the actual runtime boundary.** The Python code does more than launch a shader: it supplies tensor storage, shape arguments, dtype handling, synchronization, and integration with `mlx-lm` caches.
2. **The kernels are JIT-oriented.** The existing source files explicitly document that they are compiled by `mx.fast.metal_kernel` at call time, rather than being separately compiled libraries.
3. **A Node ABI would be a new public contract.** We would need to specify tensor layout, ownership, synchronization, errors, supported dtypes, batch/shape conventions, and zero-copy behavior.
4. **Packaging would be platform-sensitive.** A native addon would need Apple Silicon builds, Node-API compatibility, macOS deployment targets, code-signing/notarization decisions, and a fallback for unsupported machines.
5. **Metal alone does not provide the model integration.** The current value comes from the complete MLX/`mlx-lm` path, not from isolated shader dispatch.

## Recommended architecture

### Phase 1: Python worker (current foundation)

Keep the existing `runVeloxquantJson()` and `startServer()` paths. Add typed wrappers for operations that can return structured data. This is the correct path for method metadata, profiling, precompute, routing, and benchmarks.

### Phase 2: persistent local worker

Add an optional long-lived worker protocol for repeated tensor-adjacent operations:

- one Python process per SDK session;
- JSON control messages over stdin/stdout or a local Unix socket;
- large arrays passed by temporary `.npy`/memory-mapped files initially;
- explicit request IDs, cancellation, and version negotiation;
- no shell interpolation and no network listener by default.

This removes repeated Python startup without freezing the public API to a native tensor ABI.

### Phase 3: native acceleration investigation

Only pursue a Node-API or Swift implementation after the worker API has stabilized and benchmarks show that process/IPC overhead is material. Start with one isolated operation such as RoPE recoding or bit packing, not a full KV-cache implementation.

Required proof before implementation:

- numerical parity against the Python/MLX implementation;
- end-to-end benchmark including serialization and synchronization;
- memory ownership and zero-copy measurements;
- Node-API build matrix for supported Node versions;
- Apple Silicon packaging and fallback plan;
- signed/notarized distribution decision.

## Decision

Do not add a direct Metal addon in the current release. Implement the persistent Python worker and structured operation wrappers first. Re-open native addon work only if measured workloads demonstrate that the worker boundary is the bottleneck.

## References

- [Node-API ABI stability](https://nodejs.org/api/n-api.html)
- [MLX custom Metal kernels](https://github.com/ml-explore/mlx/blob/main/docs/src/dev/custom_metal_kernels.rst)
- [MLX fast implementation](https://github.com/ml-explore/mlx/blob/main/python/src/fast.cpp)
- [Apple MTLComputeCommandEncoder](https://developer.apple.com/documentation/metal/mtlcomputecommandencoder/)

