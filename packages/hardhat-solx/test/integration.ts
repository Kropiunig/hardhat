import type { CompilerOutputContract } from "hardhat/types/solidity";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useFixtureProject } from "@nomicfoundation/hardhat-test-utils";
import {
  createHardhatRuntimeEnvironment,
  importUserConfig,
  resolveHardhatConfigPath,
} from "hardhat/hre";

// The plugin augments `CompilerOutputBytecode` with the optional
// solx-only `debugInfo` field in `src/type-extensions.ts`; importing the
// plugin entrypoint here makes that augmentation visible to this test
// file's typed accesses.
import "../src/index.js";

describe("hardhat-solx integration", () => {
  useFixtureProject("simple");

  async function createHre() {
    const configPath = await resolveHardhatConfigPath();
    const userConfig = await importUserConfig(configPath);
    return await createHardhatRuntimeEnvironment(userConfig);
  }

  it("resolves plugin config through the HRE", async () => {
    const hre = await createHre();
    assert.equal(hre.config.solx.dangerouslyAllowSolxInProduction, false);
  });

  it("resolves plugin config with defaults when not specified", async () => {
    const hre = await createHardhatRuntimeEnvironment({
      solidity: {
        profiles: {
          default: {
            version: "0.8.34",
          },
          solx: {
            type: "solx",
            version: "0.8.34",
          },
        },
      },
      plugins: [(await import("../src/index.js")).default],
    });

    assert.equal(hre.config.solx.dangerouslyAllowSolxInProduction, false);
  });

  it("default profile compilers use solc (no type or 'solc')", async () => {
    const hre = await createHre();

    const defaultProfile = hre.config.solidity.profiles.default;
    assert.ok(defaultProfile !== undefined, "default profile should exist");
    assert.ok(
      defaultProfile.compilers.length > 0,
      "should have at least one compiler",
    );
    const compilerType = defaultProfile.compilers[0].type;
    assert.ok(
      compilerType === undefined || compilerType === "solc",
      `default profile compiler type should be solc, got: ${compilerType}`,
    );
  });

  it("includes 'solx' build profile in resolved config", async () => {
    const hre = await createHre();

    const profileNames = Object.keys(hre.config.solidity.profiles);
    assert.ok(
      profileNames.includes("solx"),
      `Expected "solx" profile in: ${profileNames.join(", ")}`,
    );

    const solxProfile = hre.config.solidity.profiles.solx;
    assert.equal(
      solxProfile.compilers[0].type,
      "solx",
      "solx profile compiler should have type: 'solx'",
    );
  });

  it("registers 'solx' as a compiler type", async () => {
    const hre = await createHre();

    assert.ok(
      hre.config.solidity.registeredCompilerTypes.includes("solx"),
      "registeredCompilerTypes should include 'solx'",
    );
  });
});

// solx 0.1.4 leaves `evm.{deployed,}Bytecode.sourceMap` empty and emits
// source-mapping info as DWARF in `evm.{deployed,}Bytecode.debugInfo`. The
// plugin auto-augments `outputSelection` to request those fields so EDR can
// render Solidity stack traces. This block compiles a small contract with
// solx (downloading the binary on first run) and asserts the contract is
// produced.
//
// `solx 0.1.4` weighs in at ~50MB, so this test downloads the compiler on
// first run and is gated behind `HARDHAT_DISABLE_SLOW_TESTS=true` to mirror
// the hardhat repo's other compile-heavy tests.
describe(
  "hardhat-solx output augmentation",
  { skip: process.env.HARDHAT_DISABLE_SLOW_TESTS === "true" },
  () => {
    useFixtureProject("with-debug-info");

    async function createHre() {
      const configPath = await resolveHardhatConfigPath();
      const userConfig = await importUserConfig(configPath);
      return await createHardhatRuntimeEnvironment(userConfig);
    }

    // Each fixture contract exercises a different bytecode shape:
    //   Counter            — runtime revert via an internal helper
    //   ConstructorRevert  — CREATE-time revert (separate creation blob)
    //   InlineAsm          — revert from a hand-written `assembly { ... }`
    // The plugin must produce non-empty debugInfo on both `evm.bytecode`
    // (creation) and `evm.deployedBytecode` (runtime) for all of them.
    const FIXTURES: ReadonlyArray<{ source: string; contract: string }> = [
      { source: "Counter.sol", contract: "Counter" },
      { source: "ConstructorRevert.sol", contract: "ConstructorRevert" },
      { source: "InlineAsm.sol", contract: "InlineAsm" },
    ];

    it("solx-compiled artifacts carry evm.bytecode.debugInfo and evm.deployedBytecode.debugInfo", async () => {
      const hre = await createHre();

      const rootFilePaths = await hre.solidity.getRootFilePaths({
        scope: "contracts",
      });
      const fixturePaths = FIXTURES.map(({ source }) => {
        const path = rootFilePaths.find((p) => p.endsWith(`/${source}`));
        assert.ok(
          path !== undefined,
          `${source} should be a build root, got: ${rootFilePaths.join(", ")}`,
        );
        return path;
      });

      const jobsResult = await hre.solidity.getCompilationJobs(fixturePaths, {
        force: true,
        quiet: true,
        buildProfile: "solx",
      });
      assert.ok(
        jobsResult.success,
        "getCompilationJobs should succeed for the solx profile",
      );

      // The fixtures are independent (no shared imports) so they can land in
      // separate jobs; run each one and merge outputs by source path.
      const seenJobs = new Set<unknown>();
      const mergedContracts: Record<
        string,
        Record<string, CompilerOutputContract>
      > = {};
      const mergedErrors: Array<{ severity: string; message: string }> = [];
      for (const job of jobsResult.compilationJobsPerFile.values()) {
        if (seenJobs.has(job)) continue;
        seenJobs.add(job);
        const { output } = await hre.solidity.runCompilationJob(job, {
          quiet: true,
          buildProfile: "solx",
        });
        for (const e of output.errors ?? []) {
          mergedErrors.push(e);
        }
        for (const [src, contracts] of Object.entries(output.contracts ?? {})) {
          mergedContracts[src] = {
            ...(mergedContracts[src] ?? {}),
            ...contracts,
          };
        }
      }

      const errors = mergedErrors.filter((e) => e.severity === "error");
      assert.equal(
        errors.length,
        0,
        `solx compilation produced errors: ${errors.map((e) => e.message).join(", ")}`,
      );

      for (const { source, contract } of FIXTURES) {
        const sourcePath = `project/contracts/${source}`;
        const compiled = mergedContracts[sourcePath]?.[contract];
        assert.ok(
          compiled !== undefined,
          `${contract} not found at ${sourcePath}. Sources: ${Object.keys(mergedContracts).join(", ")}`,
        );

        const evm = compiled.evm;
        assert.ok(evm !== undefined, `${contract}: expected evm in output`);

        const { bytecode, deployedBytecode } = evm;
        assert.ok(bytecode !== undefined, `${contract}: expected evm.bytecode`);
        assert.ok(
          deployedBytecode !== undefined,
          `${contract}: expected evm.deployedBytecode`,
        );

        const { debugInfo: creationDebugInfo } = bytecode;
        const { debugInfo: runtimeDebugInfo } = deployedBytecode;

        // Core assertion: the plugin must add debugInfo to outputSelection so
        // EDR can render solx-aware stack traces. solc artifacts wouldn't
        // carry this field at all; solx artifacts must.
        assert.ok(
          creationDebugInfo !== undefined && creationDebugInfo.length > 0,
          `${contract}: expected evm.bytecode.debugInfo to be a non-empty hex string`,
        );
        assert.ok(
          runtimeDebugInfo !== undefined && runtimeDebugInfo.length > 0,
          `${contract}: expected evm.deployedBytecode.debugInfo to be a non-empty hex string`,
        );

        // Sanity-check the blobs are hex-encoded ELFs (the wire format EDR
        // expects). The leading bytes are `\x7fELF` = 0x7f454c46.
        assert.ok(
          creationDebugInfo.toLowerCase().startsWith("7f454c46"),
          `${contract}: evm.bytecode.debugInfo should start with the ELF magic bytes (7f454c46)`,
        );
        assert.ok(
          runtimeDebugInfo.toLowerCase().startsWith("7f454c46"),
          `${contract}: evm.deployedBytecode.debugInfo should start with the ELF magic bytes (7f454c46)`,
        );

        // Symmetry: solx 0.1.4 leaves the legacy sourceMap empty because all
        // source-mapping info now lives in DWARF. If this ever changes
        // upstream, EDR's routing of solx artifacts may need to adapt.
        assert.equal(
          bytecode.sourceMap,
          "",
          `${contract}: expected evm.bytecode.sourceMap to be empty for solx artifacts`,
        );
        assert.equal(
          deployedBytecode.sourceMap,
          "",
          `${contract}: expected evm.deployedBytecode.sourceMap to be empty for solx artifacts`,
        );
      }
    });
  },
);
