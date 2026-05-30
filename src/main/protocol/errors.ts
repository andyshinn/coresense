/** Thrown when a contact operation references a public key that isn't in the
 *  discovered pool, so it can't be added to the radio or favourited. Maps to
 *  HTTP 422 (request well-formed, but the referenced contact can't be acted
 *  on) rather than a 503 device error. */
export class UnknownContactError extends Error {
  constructor(public readonly publicKeyHex: string) {
    super(`unknown discovered contact ${publicKeyHex}`);
    this.name = 'UnknownContactError';
  }
}
