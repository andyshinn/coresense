import type { Channel } from '../../shared/types';

/** Build the official MeshCore channel-share URI (docs.meshcore.io/qr_codes):
 *  `meshcore://channel/add?name=<url-encoded>&secret=<32-hex>`. Returns null
 *  when the channel carries no secret, so callers can hide the share UI. */
export function buildChannelShareUri(channel: Channel): string | null {
  if (!channel.secretHex) return null;
  return `meshcore://channel/add?name=${encodeURIComponent(channel.name)}&secret=${channel.secretHex}`;
}
