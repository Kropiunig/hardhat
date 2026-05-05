---
"@nomicfoundation/hardhat-solx": minor
---

The `hardhat-solx` plugin now auto-augments `outputSelection` with `evm.bytecode.debugInfo` and `evm.deployedBytecode.debugInfo`. solx 0.1.4+ ships source-mapping info as DWARF in those fields (the legacy `sourceMap` is emitted empty), and EDR consumes the DWARF to render Solidity stack traces. Without this, traces from solx-compiled tests have no source location.

Existing user `outputSelection` entries are preserved; we only add the two debugInfo selectors where they're not already requested.
