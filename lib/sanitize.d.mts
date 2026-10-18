export type SanitizeReason =
  | "absolute"
  | "traversal"
  | "invalid"
  | "too_deep"
  | "too_long";

export type SanitizeResult =
  | { ok: true; path: string; isDir: boolean }
  | { ok: false; reason: SanitizeReason };

export interface SanitizeLimits {
  maxDepth: number;
  maxPathLength: number;
}

export declare function sanitizeEntryPath(
  rawName: string,
  limits: SanitizeLimits,
): SanitizeResult;
export declare function isSystemNoise(path: string): boolean;
export declare function hasGitSegment(path: string): boolean;
export declare function hasNodeModulesSegment(path: string): boolean;
