import { Drop } from 'liquidjs';

export class PlaceholderDrop extends Drop {
  constructor(public readonly text: string) {
    super();
  }
  // Any property access on an empty value resolves to the placeholder text.
  liquidMethodMissing(): unknown {
    return this.text;
  }
  valueOf(): string {
    return this.text;
  }
  toString(): string {
    return this.text;
  }
  // JSON.stringify walks own enumerable fields and would otherwise leak the
  // `text` field name through the `json` / `inspect` filters. valueOf() is not
  // consulted by those filters, so toJSON is the only hook that works.
  toJSON(): string {
    return this.text;
  }
}

export function isPlaceholder(v: unknown): v is PlaceholderDrop {
  return v instanceof PlaceholderDrop;
}
