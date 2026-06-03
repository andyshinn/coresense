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

/** Thrown when CMD_ADD_UPDATE_CONTACT is rejected with ERR_CODE_TABLE_FULL —
 *  the radio's on-device contact store is full (overwrite-oldest off, or every
 *  slot is a favourite). Maps to HTTP 409. The message is user-facing. */
export class ContactTableFullError extends Error {
  constructor() {
    super('Contact list full — remove a contact or enable overwrite-oldest.');
    this.name = 'ContactTableFullError';
  }
}
