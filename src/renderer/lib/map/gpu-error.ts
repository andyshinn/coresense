// maplibre-gl 6 dropped its WebGL1 fallback: when a WebGL2 context can't be
// created the Map constructor throws GPUInitializationError, which the
// ErrorBoundary around MapCanvas turns into MapErrorFallback. Match by `name` (a
// string literal upstream, so it survives minification) instead of
// `instanceof` — importing the class would drag maplibre-gl into the
// eagerly-loaded error fallback chunk.
export function isGpuInitializationError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'GPUInitializationError';
}
