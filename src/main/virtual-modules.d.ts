// Ambient module declarations for the virtual modules emitted by
// unplugin-info (configured in vite.main.config.mts). Mirrors the upstream
// types from `unplugin-info/client` — duplicated here because the upstream
// types ship as a subpath import which TypeScript's `reference types`
// directive cannot resolve.

declare module '~build/git' {
  export const sha: string;
  export const abbreviatedSha: string;
  export const branch: string;
  export const tag: string | null;
}

declare module '~build/package' {
  export const name: string;
  export const version: string;
}
