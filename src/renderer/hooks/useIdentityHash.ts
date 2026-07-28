import { useMemo } from 'react';
import { buildDiscoveredNameIndex, identityHashInput, resolveIdentity } from '../lib/identity';
import { useStore } from '../lib/store';

/** Resolve a raw from_pk to the string that should drive its ramp slot, under
 *  the user's current identity-colour mode. Returns null for a neutral mark. */
export function useIdentityHash(fromPk: string | null | undefined, fallbackName?: string): string | null {
  const mode = useStore((s) => s.appSettings.identityColorMode ?? 'byKey');
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  return useMemo(() => {
    const index = buildDiscoveredNameIndex(discovered);
    const resolved = resolveIdentity(fromPk, contacts, index);
    const hash = identityHashInput(resolved, mode);
    if (hash) return hash;
    // A caller that already knows the display name (ColoredUsername's `name`
    // prop, ContactAvatar's `name`) can still be coloured under byName.
    return mode === 'byName' ? (fallbackName ?? null) : null;
  }, [fromPk, fallbackName, contacts, discovered, mode]);
}
