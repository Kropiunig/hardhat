import type { SolidityCompilerType } from "hardhat/types/config";

/**
 * The compiler type identifier registered by this plugin.
 * Typed as SolidityCompilerType for type-safe comparisons.
 */
export const SOLX_COMPILER_TYPE: SolidityCompilerType = "solx";

export const SOLX_RELEASES_BASE_URL =
  "https://solx-releases-mirror.hardhat.org";

export const SUPPORTED_SOLX_EVM_VERSIONS: readonly string[] = [
  "cancun",
  "prague",
  "osaka",
] as const;

export const DEFAULT_SOLX_SETTINGS: Record<string, unknown> = {
  viaIR: false,
  LLVMOptimization: "1",
};

/**
 * Maps Solidity compiler versions to the solx version that embeds them.
 * Only stable solx releases that emit DWARF debug info are included —
 * earlier solx versions (≤ 0.1.3) leave both `sourceMap` and the new
 * `debugInfo` selectors empty, so EDR cannot render stack traces for
 * artifacts produced by them.
 */
export const SOLIDITY_TO_SOLX_VERSION_MAP: Record<string, string> = {
  "0.8.34": "0.1.4",
};
