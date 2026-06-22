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
}

export function isPlaceholder(v: unknown): v is PlaceholderDrop {
  return v instanceof PlaceholderDrop;
}
