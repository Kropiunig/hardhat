// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

// Reverts from inside an inline-assembly block. Solidity does not emit
// per-opcode debug rows for hand-written assembly, so the resulting DWARF
// line table is sparser than for ordinary code. Used by the integration
// test to assert the plugin's `outputSelection` augmentation still produces
// non-empty `evm.bytecode.debugInfo` / `evm.deployedBytecode.debugInfo`
// for this shape of bytecode.
contract InlineAsm {
    function boom() external pure {
        assembly {
            mstore(0x00, 0x08c379a000000000000000000000000000000000000000000000000000000000)
            mstore(0x04, 0x20)
            mstore(0x24, 0x04)
            mstore(0x44, 0x61736d00000000000000000000000000000000000000000000000000000000)
            revert(0x00, 0x64)
        }
    }
}
