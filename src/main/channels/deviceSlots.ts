import { emit } from '../events/bus';
import { protocolSession } from '../protocol';
import { stateHolder } from '../state/holder';

const REJECTED = 'radio rejected SET_CHANNEL or timed out';

export type PushChannelResult =
  | { status: 'ok'; idx: number }
  | { status: 'unknown' }
  | { status: 'noFreeSlot' }
  | { status: 'rejected'; message: string };

export type RemoveChannelResult =
  | { status: 'ok' }
  | { status: 'unknown' }
  | { status: 'noSlot' }
  | { status: 'rejected'; message: string };

/** Push an app-stored channel to a free slot on the connected device. If the
 *  channel already has a confirmed `idx` (i.e. it's already on the device),
 *  that slot is overwritten — effectively an "edit in place". */
export async function pushChannelToDevice(key: string): Promise<PushChannelResult> {
  const holder = stateHolder();
  const channel = holder.getChannels().find((ch) => ch.key === key);
  if (!channel) return { status: 'unknown' };
  const session = protocolSession();
  const onDevice = new Set(session.getDevicePresence()).has(key);
  const idx = onDevice && typeof channel.idx === 'number' ? channel.idx : session.pickFreeSlot();
  if (idx === null) return { status: 'noFreeSlot' };
  const secret = channel.secretHex ?? session.deriveSecret(channel.name);
  if (!(await session.setChannel(idx, channel.name, secret))) return { status: 'rejected', message: REJECTED };
  // Stamp the now-confirmed idx + derived secret onto our copy so future
  // sends route to the right slot even before the next enumeration.
  const updated = { ...channel, idx, secretHex: secret };
  holder.upsertChannel(updated);
  // Firmware doesn't push a CHANNEL_INFO back for SET — update local
  // presence state ourselves so the renderer un-grays the channel
  // immediately rather than waiting for the next reconnect enumeration.
  session.markChannelPresent(updated);
  emit.channels(holder.getChannels());
  return { status: 'ok', idx };
}

/** "Remove from device" — zero out the slot so the firmware's empty-key filter
 *  hides it on next enumeration. The channel stays in app storage (history is
 *  preserved); DELETE /api/channels/:key forgets it entirely. */
export async function removeChannelFromDevice(key: string): Promise<RemoveChannelResult> {
  const holder = stateHolder();
  const channel = holder.getChannels().find((ch) => ch.key === key);
  if (!channel) return { status: 'unknown' };
  if (typeof channel.idx !== 'number') return { status: 'noSlot' };
  const session = protocolSession();
  if (!(await session.setChannel(channel.idx, '', '00'.repeat(16)))) return { status: 'rejected', message: REJECTED };
  // Free the slot in the dispatch map + clear presence so the renderer
  // grays the channel without waiting for the next enumeration.
  session.markChannelAbsent(channel.idx);
  // Forget the device slot — channel becomes "app-only" until pushed again.
  holder.upsertChannel({ ...channel, idx: undefined });
  emit.channels(holder.getChannels());
  return { status: 'ok' };
}
