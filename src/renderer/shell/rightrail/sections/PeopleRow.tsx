import { MessageSquare, UserPlus } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TimeFormatPref } from '../../../../shared/types';
import { IDENTITY_NEUTRAL_VAR, identityDotVar } from '../../../lib/contactColor';
import { useStore } from '../../../lib/store';
import { fmtDateTime, fmtTime, fmtTimePrecise } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { fmtAge, fmtCount, type RosterRow, volumeWidth } from './peopleModel';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The absolute timestamp behind the compact age, one rung per ladder step. */
export function fmtAgeAbsolute(ts: number, now: number, pref: TimeFormatPref): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'Never';
  const elapsed = Math.max(0, now - ts);
  if (elapsed < MIN) return fmtTimePrecise(ts, pref);
  if (elapsed < DAY) return fmtTime(ts, pref);
  if (elapsed < 7 * DAY) return `${new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })} ${fmtTime(ts, pref)}`;
  return fmtDateTime(ts, pref);
}

interface PeopleRowProps {
  row: RosterRow;
  now: number;
  maxCount: number;
  showVolume: boolean;
  railWidth: number;
  timeFormat: TimeFormatPref;
  onOpen: (row: RosterRow) => void;
  onMessage: (row: RosterRow) => void;
  onAddContact: (row: RosterRow) => void;
}

export function PeopleRow({
  row,
  now,
  maxCount,
  showVolume,
  railWidth,
  timeFormat,
  onOpen,
  onMessage,
  onAddContact,
}: PeopleRowProps) {
  const mode = useStore((s) => s.appSettings.identityColorMode ?? 'byKey');
  const hashInput = mode === 'byName' ? row.name : row.pubkey;
  const hue = hashInput === null ? IDENTITY_NEUTRAL_VAR : identityDotVar(hashInput);

  // The name tooltip exists only to recover a name the column clipped. Showing
  // it on every row would fire a tooltip on the whole list. Rows are keyed by
  // `r.id`, so an instance survives a rail resize — re-measure whenever
  // `railWidth` changes (it also crosses the showVolume breakpoint, which
  // changes the name track's own width by 38px) or the name itself changes,
  // rather than only once at mount. No ResizeObserver: railWidth already
  // comes from the store via the body, so this is a plain dependency, not a
  // new subscription.
  const nameRef = useRef<HTMLButtonElement>(null);
  const [clipped, setClipped] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: row.name/showVolume/railWidth are re-measure triggers, not read inside the effect
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (el) setClipped(el.scrollWidth > el.clientWidth);
  }, [row.name, showVolume, railWidth]);

  // Three tiers, and they map 1:1 onto what the row can do:
  //   filled + hued  saved contact          -> message
  //   hollow + hued  advert heard, unsaved  -> add to contacts
  //   hollow + grey  name only              -> nothing actionable
  const canMessage = row.contactKey !== null && !row.blocked;
  const canAdd = !row.inContacts && row.pubkey !== null && !row.blocked;

  const messageHint = row.blocked ? 'Blocked' : row.contactKey ? `Message ${row.name}` : 'Add to contacts to message';
  const addHint = row.blocked
    ? 'Blocked'
    : row.pubkey
      ? `Add ${row.name} to contacts`
      : 'No advert heard from this node yet';

  return (
    // The row itself is not the interactive element: the name button inside it
    // carries focus, Enter, and the accessible name. This onClick only widens
    // the mouse target to the full row — a keyboard user already reaches the
    // row's action via Tab landing on the name button. Adding a role/tabIndex
    // here to satisfy these rules would nest a second interactive stop in the
    // tab order for one row.
    // biome-ignore lint/a11y/noStaticElementInteractions: see comment above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see comment above.
    <div
      className={cn(
        'group relative grid h-6 items-center gap-2 px-2.5',
        'hover:bg-cs-bg-3 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring',
      )}
      style={{
        gridTemplateColumns: showVolume ? '7px 1fr 30px 26px 30px' : '7px 1fr 26px 30px',
      }}
      onClick={() => onOpen(row)}
    >
      <span
        aria-hidden
        className="size-[7px] justify-self-center rounded-full"
        style={
          row.inContacts
            ? { backgroundColor: hue }
            : { backgroundColor: 'transparent', boxShadow: `inset 0 0 0 1.5px ${hue}` }
        }
      />

      {/* The name is a real button: it carries focus and Enter for the whole
          row, so the row div itself needs no tabIndex and there are no nested
          interactive elements. */}
      <Tooltip delayDuration={400} open={clipped ? undefined : false}>
        <TooltipTrigger asChild>
          <button
            ref={nameRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row);
            }}
            className="truncate bg-transparent text-left text-[12.5px] font-medium text-cs-text outline-none"
          >
            {row.name}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{row.name}</TooltipContent>
      </Tooltip>

      {showVolume && (
        <span aria-hidden className="h-[3px] rounded-[2px] bg-cs-accent/14">
          <span
            className="block h-full rounded-[2px] bg-cs-accent/78"
            style={{ width: volumeWidth(row.msgCount, maxCount) }}
          />
        </span>
      )}

      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <span className="text-right font-mono text-[11px] tabular-nums text-cs-text-muted">{fmtCount(row.msgCount)}</span>
        </TooltipTrigger>
        <TooltipContent side="left">{`${row.msgCount} messages seen in this channel`}</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <span className="whitespace-nowrap text-right font-mono text-[10.5px] tabular-nums text-cs-text-dim">
            {fmtAge(row.lastSeenAt, now)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{fmtAgeAbsolute(row.lastSeenAt, now, timeFormat)}</TooltipContent>
      </Tooltip>

      <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5 bg-gradient-to-r from-transparent to-cs-bg-3 to-34% pl-6 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none">
        <RowAction
          icon={<MessageSquare className="size-3" />}
          label={messageHint}
          disabled={!canMessage}
          onClick={() => onMessage(row)}
        />
        {!row.inContacts && (
          <RowAction
            icon={<UserPlus className="size-3" />}
            label={addHint}
            disabled={!canAdd}
            onClick={() => onAddContact(row)}
          />
        )}
      </span>
    </div>
  );
}

function RowAction({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        {/* A disabled button emits no pointer events, so the tooltip would never
            fire on exactly the rows whose explanation matters most. Keep it
            enabled and inert instead. */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-disabled={disabled}
          className={cn('size-5 rounded-[5px] hover:bg-cs-bg-3 hover:text-cs-text', disabled && 'opacity-40')}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onClick();
          }}
        >
          {icon}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
