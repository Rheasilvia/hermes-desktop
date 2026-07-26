// Build-time version identifier, injected by Vite `define` (see vite.config.ts).
// These globals are replaced with string literals at build time; `declare const`
// (module-scoped) gives them a type without relying on global augmentation.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

/** Semantic app version, e.g. "0.1.0". */
export const APP_VERSION: string = __APP_VERSION__;

/** Short git commit hash of the build, e.g. "258a883" (or "unknown" if not a git checkout). */
export const APP_COMMIT: string = __APP_COMMIT__;
