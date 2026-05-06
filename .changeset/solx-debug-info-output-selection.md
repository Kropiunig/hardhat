---
"@nomicfoundation/hardhat-solx": minor
---

The `hardhat-solx` plugin now auto-augments `outputSelection` with `evm.bytecode.debugInfo` and `evm.deployedBytecode.debugInfo`. solx 0.1.4+ ships source-mapping info as DWARF in those fields (the legacy `sourceMap` is emitted empty), and EDR consumes the DWARF to render Solidity stack traces. Without this, traces from solx-compiled tests have no source location.

Existing user `outputSelection` entries are preserved; we only add the two debugInfo selectors where they're not already requested.

Solidity `0.8.33` (which mapped to solx `0.1.3`) is no longer supported. solx `0.1.3` predates the DWARF debug-info backend and silently ignores the new `debugInfo` selectors, which would result in EDR failing at trace-render time rather than at compile time. Users on `version: "0.8.33"` should bump to `0.8.34`.
