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
export const SOLX_DEBUG_INFO_SELECTORS = [
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

    // TODO https://github.com/NomicFoundation/hardhat/issues/<filed-with-this-PR>:
    // ideally this augmentation lives in a `preprocessSolcInputBeforeBuilding`
    // hook so it lands in the cached `solcInput` (and therefore in the recorded
    // build-info), participates in the build-ID hash, and is visible to other
    // plugin handlers. Today the hook is invoked without `solcConfig`, so it
    // can't gate on `type === "solx"` — fixing it requires a Hardhat 3 core
    // change to thread `solcConfig` through. Until then we mutate at compile
    // time, which means the build-info on disk lies about the actual
    // outputSelection that was sent to solx.
    const modifiedInput: CompilerInput = {
      ...input,
      settings: {
        ...this.#extraSettings,
        ...input.settings,
        outputSelection: await addSolxDebugInfoSelectors(
          input.settings?.outputSelection,
        ),
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
 */
export async function addSolxDebugInfoSelectors(
  outputSelection:
    | NonNullable<CompilerInput["settings"]>["outputSelection"]
    | undefined,
): Promise<NonNullable<CompilerInput["settings"]>["outputSelection"]> {
  const cloned: Record<string, Record<string, string[]>> = await deepClone(
    outputSelection ?? {},
  );

  // Hardhat normalizes outputSelection to populate `["*"]["*"]` upstream, but
  // unit tests construct the input directly with `{}`, so make sure the slot
  // exists before we push.
  cloned["*"] ??= {};
  cloned["*"]["*"] ??= [];
  cloned["*"]["*"].push(...SOLX_DEBUG_INFO_SELECTORS);

  return cloned;
}
