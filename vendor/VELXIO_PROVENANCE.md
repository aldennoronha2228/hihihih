# Velxio source provenance

Upstream: https://github.com/davidmonterocrespo24/velxio

Imported revision: `3e45cada3f362ce61fe2c8515f7fee0f7acf4113`

The `velxio` directory contains upstream source, including its original `LICENSE`, copyright notices, and `COMMERCIAL_LICENSE.md`. WireUp integrates reusable hardware/editor/emulation modules into a separate dark application shell. The upstream source and attribution are retained.

Local compatibility patch: `frontend/src/simulation/I2CBusManager.ts` uses an explicit `unknown` intermediate assertion for TypeScript 6 compatibility; runtime behavior is unchanged. `EPaperElement.ts` removes an unused `DEFAULT_PANEL_KIND` import when registering the complete component catalog.

Local reliability patch: `frontend/src/services/ComponentRegistry.ts` clears the shared load promise when an attempt finishes and propagates load failures. Concurrent callers still share one attempt, but a later `load()` or `reload()` can retry failed metadata loading instead of reusing a resolved, empty-registry promise. The module's eager initialization reports its rejection explicitly, avoiding an unhandled promise while retaining caller-visible failures.

Velxio is AGPLv3/commercial dual-licensed. Integrated distribution and network-accessible modified deployments must comply with the applicable license. A proprietary deployment requires appropriate commercial licensing from the upstream author. See `velxio/LICENSE` and `velxio/COMMERCIAL_LICENSE.md`.
