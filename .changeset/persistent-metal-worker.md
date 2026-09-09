---
"@veloxquant/sdk": minor
---

Add a persistent MLX/Metal worker bridge (`VeloxQuantWorker`) for Node.js. Exposes `ping()`,
`capabilities()`, `metalProbe()`, `bitPack()`, `bitPackFile()`, and `ropeRecodeFile()` over a
long-lived JSON-lines subprocess, with `.npy` file-backed tensor transport for large arrays.
