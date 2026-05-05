import type {
  Compiler,
  CompilerInput,
  CompilerOutput,
} from "hardhat/types/solidity";

import { spawnCompile as defaultSpawnCompile } from "hardhat/internal/solidity";

/**
 * solx 0.1.4+ leaves `evm.{deployed,}Bytecode.sourceMap` empty and emits source
 * mapping information as DWARF in `evm.{deployed,}Bytecode.debugInfo` instead.
 * EDR consumes that DWARF to render Solidity stack traces, so the plugin opts
 * into it on every compile by augmenting the user's outputSelection.
 */
const SOLX_DEBUG_INFO_SELECTORS = [
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

    // Merge default solx settings with user settings. User settings take
    // precedence, allowing overrides of viaIR, LLVMOptimization, etc.
    const modifiedInput: CompilerInput = {
      ...input,
      settings: {
        ...this.#extraSettings,
        ...input.settings,
        outputSelection: addSolxDebugInfoSelectors(
          input.settings?.outputSelection,
        ),
      },
    };

    return await this.#spawnCompile(this.compilerPath, args, modifiedInput);
  }
}

/**
 * Returns a new outputSelection where every contract entry includes the solx
 * debugInfo selectors. Existing user selectors are preserved; we never remove
 * anything, only add what's missing.
 */
function addSolxDebugInfoSelectors(
  outputSelection: NonNullable<CompilerInput["settings"]>["outputSelection"],
): NonNullable<CompilerInput["settings"]>["outputSelection"] {
  // Deep-clone so we don't mutate the caller's object.
  const cloned: Record<string, Record<string, string[]>> = JSON.parse(
    JSON.stringify(outputSelection ?? {}),
  );

  // Hardhat's defaults populate `cloned['*']['*']`. If the caller passed an
  // empty selection, ensure the wildcard slot exists so our selectors take effect.
  cloned["*"] ??= {};
  cloned["*"]["*"] ??= [];

  for (const sourceMap of Object.values(cloned)) {
    for (const contractKey of Object.keys(sourceMap)) {
      if (contractKey === "") {
        // The empty-string contract key is for file-level outputs (e.g. `ast`);
        // none of those carry per-contract debugInfo. Leave it alone.
        continue;
      }
      const selectors = sourceMap[contractKey];
      for (const sel of SOLX_DEBUG_INFO_SELECTORS) {
        if (!selectors.includes(sel)) {
          selectors.push(sel);
        }
      }
    }
  }

  return cloned;
}
