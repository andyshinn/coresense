import { Check, X } from 'lucide-react';
import { TELEM_PERM_BASE, TELEM_PERM_ENVIRONMENT, TELEM_PERM_LOCATION } from '../../../shared/telemetry/types';
import type { RepeaterAclRole } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { roleLabel } from './format';
import { LABEL_CAPS, TelemetryChip } from './ui';

const PERMS = [
  { bit: TELEM_PERM_BASE, label: 'Base' },
  { bit: TELEM_PERM_LOCATION, label: 'Location' },
  { bit: TELEM_PERM_ENVIRONMENT, label: 'Environment' },
] as const;

interface Props {
  /** Inferred TELEM_PERM_* mask; null (unknown) renders nothing. */
  permsGranted: number | null;
  aclRole: RepeaterAclRole | null;
  className?: string;
}

/**
 * "Granted as admin  ✓ Base  ✓ Location  ✓ Environment". The reply carries no
 * grant mask, so `permsGranted` is inferred from the login role; a guest shows
 * Location and Environment as not granted.
 */
export function PermissionChips({ permsGranted, aclRole, className }: Props) {
  if (permsGranted === null) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className={LABEL_CAPS}>{aclRole ? `Granted as ${roleLabel(aclRole)}` : 'Granted'}</span>
      {PERMS.map(({ bit, label }) => {
        const granted = (permsGranted & bit) !== 0;
        return (
          <TelemetryChip key={label} tone={granted ? 'ok' : 'off'}>
            {granted ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
            {label}
            <span className="sr-only">{granted ? ' granted' : ' not granted'}</span>
          </TelemetryChip>
        );
      })}
    </div>
  );
}
