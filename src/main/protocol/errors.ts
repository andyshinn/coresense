/** Thrown by a SessionAdapter method whose meshcore-ts counterpart doesn't
 *  exist in the installed library (feature-detected at call time, so the app
 *  builds and runs against an older release). `feature` names the missing
 *  library API. Maps to HTTP 501 `lib_unsupported`. */
export class LibUnsupportedError extends Error {
  constructor(public readonly feature: string) {
    super(`${feature} needs a newer meshcore-ts`);
    this.name = 'LibUnsupportedError';
  }
}
