// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

// Constructor calls an internal helper that reverts. Exercises the
// solx-emitted DWARF for **CREATE bytecode** (deployment-time revert),
// not just deployed/runtime bytecode. Used by the integration test to
// assert the plugin's `outputSelection` augmentation produces a
// non-empty `evm.bytecode.debugInfo` (the creation blob) in addition
// to `evm.deployedBytecode.debugInfo`.
contract ConstructorRevert {
    function _check(uint256 v) internal pure {
        require(v > 0, "constructor helper boom");
    }

    constructor(uint256 v) {
        _check(v);
    }
}
