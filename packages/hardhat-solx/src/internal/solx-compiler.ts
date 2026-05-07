import type {
  Compiler,
  CompilerInput,
  CompilerOutput,
} from "hardhat/types/solidity";

import { deepClone } from "@nomicfoundation/hardhat-utils/lang";
import { spawnCompile as defaultSpawnCompile } from "hardhat/internal/solidity";

/**
 * solx 0.1.4+ leaves `evm.{deployed,}Bytecode.sourceMap` empty and emits source
 * mapping information as DWARF in `evm.{deployed,}Bytecode.debugInfo` instead.
 * EDR consumes that DWARF to render Solidity stack traces, so the plugin opts
 * into it on every compile by augmenting the user's outputSelection.
 */
export const SOLX_DEBUG_INFO_SELECTORS: readonly string[] = [
  "evm.bytecode.debugInfo",
  "evm.deployedBytecode.debugInfo",
] as const;

export class SolxCompiler implements Compiler {
  public readonly version: string;
  public readonly longVersion: string;
  public readonly compilerPath: string;
  public readonly isSolcJs: boolean = false;

  readonly #extraSettings: Record<string, unknown>;
  readonly #spawnCompile: typeof defaultSpawnCompile;

  constructor(
    solxVersion: string,
    compilerPath: string,
    extraSettings: Record<string, unknown> = {},
    spawnCompile: typeof defaultSpawnCompile = defaultSpawnCompile,
  ) {
    this.version = solxVersion;
    this.longVersion = `${solxVersion}+solx`;
    this.compilerPath = compilerPath;
    this.#extraSettings = extraSettings;
    this.#spawnCompile = spawnCompile;
  }

  public async compile(input: CompilerInput): Promise<CompilerOutput> {
    const args = ["--standard-json", "--no-import-callback"];

    // The solx-specific outputSelection selectors are baked into the
    // resolved compiler config by the plugin's `resolveUserConfig` hook
    // (see `hook-handlers/config.ts`), so by the time hardhat constructs
    // the solc input here, `input.settings.outputSelection` already
    // includes them — no compile-time mutation needed. We only merge the
    // extra solx-specific compiler settings (LLVMOptimization, viaIR,
    // etc.) on top of the user-supplied ones.
    const modifiedInput: CompilerInput = {
      ...input,
      settings: {
        ...this.#extraSettings,
        ...input.settings,
      },
    };

    return await this.#spawnCompile(this.compilerPath, args, modifiedInput);
  }
}

/**
 * Returns a new outputSelection containing the solx debugInfo selectors at
 * the wildcard `["*"]["*"]` slot. Existing user selectors are preserved
 * verbatim; downstream `#dedupeAndSortOutputSelection` in hardhat's solidity
 * build system removes any resulting duplicates.
 *
 * Input is typed `unknown` (rather than the strictly-typed
 * `CompilerInput["settings"]["outputSelection"]`) because the call site in
 * `resolveUserConfig` reads from `solcConfig.settings`, which upstream
 * Hardhat types as `any`; widening here avoids `as`-style casts at the
 * caller (forbidden by the repo's eslint config).
 */
export async function addSolxDebugInfoSelectors(
  outputSelection: unknown,
): Promise<NonNullable<CompilerInput["settings"]>["outputSelection"]> {
  const seed: Record<
    string,
    Record<string, string[]>
  > = typeof outputSelection === "object" && outputSelection !== null
    ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- known shape
      (outputSelection as Record<string, Record<string, string[]>>)
    : {};
  const cloned: Record<string, Record<string, string[]>> = await deepClone(
    seed,
  );

  // Hardhat normalizes outputSelection to populate `["*"]["*"]` upstream, but
  // unit tests construct the input directly with `{}`, so make sure the slot
  // exists before we push.
  cloned["*"] ??= {};
  cloned["*"]["*"] ??= [];
  cloned["*"]["*"].push(...SOLX_DEBUG_INFO_SELECTORS);

  return cloned;
}
