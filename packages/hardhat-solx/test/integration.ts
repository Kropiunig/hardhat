import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useFixtureProject } from "@nomicfoundation/hardhat-test-utils";
import {
  createHardhatRuntimeEnvironment,
  importUserConfig,
  resolveHardhatConfigPath,
} from "hardhat/hre";

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
            version: "0.8.33",
          },
          solx: {
            type: "solx",
            version: "0.8.33",
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

    it("solx-compiled artifacts carry evm.bytecode.debugInfo and evm.deployedBytecode.debugInfo", async () => {
      const hre = await createHre();

      const rootFilePaths = await hre.solidity.getRootFilePaths({
        scope: "contracts",
      });
      const counterPath = rootFilePaths.find((p) => p.endsWith("Counter.sol"));
      assert.ok(
        counterPath !== undefined,
        `Counter.sol should be a build root, got: ${rootFilePaths.join(", ")}`,
      );

      const jobsResult = await hre.solidity.getCompilationJobs([counterPath], {
        force: true,
        quiet: true,
        buildProfile: "solx",
      });
      assert.ok(
        jobsResult.success,
        "getCompilationJobs should succeed for the solx profile",
      );
      const compilationJob = jobsResult.compilationJobsPerFile
        .values()
        .next().value;
      assert.ok(compilationJob !== undefined, "expected a CompilationJob");

      const { output } = await hre.solidity.runCompilationJob(compilationJob, {
        quiet: true,
        buildProfile: "solx",
      });

      const errors = (output.errors ?? []).filter(
        (e: { severity: string }) => e.severity === "error",
      );
      assert.equal(
        errors.length,
        0,
        `solx compilation produced errors: ${errors.map((e: { message: string }) => e.message).join(", ")}`,
      );

      const counterContract = output.contracts?.["project/contracts/Counter.sol"]?.Counter;
      assert.ok(
        counterContract !== undefined,
        `Counter contract not found in output. Sources: ${Object.keys(output.contracts ?? {}).join(", ")}`,
      );

      const evm = counterContract.evm;
      assert.ok(evm !== undefined, "expected evm in output");
      assert.ok(evm.bytecode !== undefined, "expected evm.bytecode");
      assert.ok(
        evm.deployedBytecode !== undefined,
        "expected evm.deployedBytecode",
      );

      // `debugInfo` is solx-specific and not part of the solc-defined
      // `CompilerOutputBytecode` interface, so access it via index notation
      // through a `Record` cast.
      const bytecode = evm.bytecode as unknown as Record<string, unknown>;
      const deployedBytecode = evm.deployedBytecode as unknown as Record<
        string,
        unknown
      >;
      const creationDebugInfo = bytecode.debugInfo;
      const runtimeDebugInfo = deployedBytecode.debugInfo;

      // The whole point: the plugin must add debugInfo to outputSelection so
      // EDR can render solx-aware stack traces. solc artifacts wouldn't have
      // this field at all; solx artifacts must.
      assert.ok(
        typeof creationDebugInfo === "string" && creationDebugInfo.length > 0,
        "expected evm.bytecode.debugInfo to be a non-empty hex string",
      );
      assert.ok(
        typeof runtimeDebugInfo === "string" && runtimeDebugInfo.length > 0,
        "expected evm.deployedBytecode.debugInfo to be a non-empty hex string",
      );

      // Sanity-check that the blobs are hex-encoded ELFs (the wire format
      // EDR expects). The leading bytes are `\x7fELF` = 0x7f454c46.
      assert.ok(
        creationDebugInfo.toLowerCase().startsWith("7f454c46"),
        "evm.bytecode.debugInfo should start with the ELF magic bytes (7f454c46)",
      );
      assert.ok(
        runtimeDebugInfo.toLowerCase().startsWith("7f454c46"),
        "evm.deployedBytecode.debugInfo should start with the ELF magic bytes (7f454c46)",
      );

      // Symmetry: solx 0.1.4 emits the legacy sourceMap as an empty string,
      // because all source-mapping info now lives in DWARF. If this ever
      // changes upstream, EDR's routing of solx artifacts may need to adapt.
      assert.equal(
        evm.bytecode.sourceMap,
        "",
        "expected evm.bytecode.sourceMap to be empty for solx artifacts",
      );
      assert.equal(
        evm.deployedBytecode.sourceMap,
        "",
        "expected evm.deployedBytecode.sourceMap to be empty for solx artifacts",
      );
    });
  },
);
