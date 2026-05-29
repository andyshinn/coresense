// Per-client inbox-replay for MeshCore proxy clients.
//
// The MeshCore device's "GET_NEXT_MSG" command (cmd=0x0a) pops a message from
// its queue. If client A drains and client B reconnects, B sees an empty inbox
// because the device already gave those messages to A. This router intercepts
// the conversation: it caches every message-bearing response in memory, gives
// each (IP + app-name) client its own cursor, and serializes the single
// outstanding 0x0a toward the device so concurrent clients can all drain
// without racing each other.

import { Buffer } from 'node:buffer';
import { emit } from '../events/bus';
import { channelHashOf } from '../protocol/paths';
import { register as registerPendingChannelSend } from '../protocol/pendingChannelSends';
import { stateHolder } from '../state/holder';
import type { BridgeClient } from './hub';
import { inboxKeyFor, parseAppStartName, parseNodeNameFromSelfInfo } from './identity';
import { InboxCache } from './inboxCache';

const CMD_APP_START = 0x01;
const CMD_SEND_CHAN_TXT_MSG = 0x03;
const CMD_GET_NEXT_MSG = 0x0a;
const RESP_SELF_INFO = 0x05;
const RESP_NO_MORE_MESSAGES = 0x0a;
const RESP_CHANNEL_MSG_RECV_V3 = 0x11;
const PUSH_MSG_WAITING = 0x83;

// Companion-frame codes that carry a popped message and therefore mutate the
// device's inbox queue. Each one needs to land in the cache.
const MSG_RECV_CODES: ReadonlySet<number> = new Set([
  0x07, // RESP_CONTACT_MSG_RECV
  0x08, // RESP_CHANNEL_MSG_RECV
  0x10, // RESP_CONTACT_MSG_RECV_V3
  0x11, // RESP_CHANNEL_MSG_RECV_V3
  0x1b, // RESP_CHANNEL_DATA_RECV
]);

const KNOWN_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

const GET_NEXT_FRAME = Buffer.from([CMD_GET_NEXT_MSG]);
const NO_MORE_FRAME = Buffer.from([RESP_NO_MORE_MESSAGES]);
const PUSH_MSG_WAITING_FRAME = Buffer.from([PUSH_MSG_WAITING]);

interface DrainLogger {
  trace: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface InboxRouterOptions {
  forwardToDevice: (client: BridgeClient, payload: Buffer) => void;
  log: DrainLogger;
}

interface LiveClientState {
  cursor: number;
  appName: string | null;
  inboxKey: string;
}

interface KnownClientState {
  cursor: number;
  lastSeen: number;
}

export class InboxRouter {
  private readonly cache = new InboxCache();
  private readonly clients = new Map<BridgeClient, LiveClientState>();
  private readonly known = new Map<string, KnownClientState>();
  private deviceQueueDrained = false;
  private inFlight: BridgeClient | null = null;
  private pending: BridgeClient[] = [];
  // Local node's display name, sniffed from RESP_SELF_INFO. Used as the sender
  // prefix when synthesizing a channel-send echo so other clients render it
  // with the same "name: text" format the wire uses.
  private nodeName: string | null = null;

  constructor(private readonly opts: InboxRouterOptions) {}

  addClient(client: BridgeClient): void {
    const inboxKey = inboxKeyFor(client.remoteIp ?? null, null);
    const restored = this.lookupKnown(inboxKey);
    // New clients replay everything still in the cache (the current BLE
    // session's backlog). Returning clients resume from their persisted cursor.
    const cursor = restored?.cursor ?? this.cache.oldestSeq();
    this.clients.set(client, { cursor, appName: null, inboxKey });
    this.opts.log.debug(
      `bind ${client.remoteAddr} key=${inboxKey} cursor=${cursor}/${this.cache.head()}`,
    );
    this.maybePromptDrain(client);
  }

  // Drop everything we cached and any per-key cursors from the previous BLE
  // session. The new BLE session may re-emit logically identical messages, so
  // we treat them as fresh. Currently-bound clients are reset to cursor 0; on
  // their next 0x0a they will pull the new session's queue from the device and
  // replay from the cache thereafter.
  reset(): void {
    this.cache.reset();
    this.known.clear();
    this.deviceQueueDrained = false;
    this.inFlight = null;
    this.pending = [];
    for (const state of this.clients.values()) {
      state.cursor = this.cache.head();
    }
    this.opts.log.debug('reset on BLE reconnect');
  }

  removeClient(client: BridgeClient): void {
    const state = this.clients.get(client);
    if (!state) return;
    this.known.set(state.inboxKey, { cursor: state.cursor, lastSeen: Date.now() });
    this.clients.delete(client);
    if (this.inFlight === client) this.inFlight = null;
    this.pending = this.pending.filter((c) => c !== client);
    this.runPending();
  }

  handleClientFrame(client: BridgeClient, payload: Buffer): 'handled' | 'forward' {
    if (payload.length === 0) return 'forward';
    const code = payload[0];

    if (code === CMD_APP_START) {
      const name = parseAppStartName(payload);
      if (name) this.rebindIdentity(client, name);
      return 'forward';
    }

    if (code === CMD_GET_NEXT_MSG && payload.length === 1) {
      this.handleGetNext(client);
      return 'handled';
    }

    if (code === CMD_SEND_CHAN_TXT_MSG && payload.length >= 8) {
      this.synthesizeChannelSend(client, payload);
      return 'forward';
    }

    return 'forward';
  }

  handleDeviceFrame(code: number, bytes: Buffer): 'consumed' | 'fanout' {
    if (code === RESP_SELF_INFO) {
      const name = parseNodeNameFromSelfInfo(bytes);
      if (name && name !== this.nodeName) {
        this.nodeName = name;
        this.opts.log.debug(`self-info: nodeName="${name}"`);
      }
      return 'fanout';
    }

    if (MSG_RECV_CODES.has(code)) {
      const entry = this.cache.append(bytes);
      this.opts.log.trace(
        `cache append seq=${entry.seq} code=0x${code.toString(16).padStart(2, '0')} (size=${this.cache.size()})`,
      );
      const target = this.inFlight;
      this.inFlight = null;
      if (target) {
        const state = this.clients.get(target);
        if (state) {
          this.deliver(target, bytes);
          state.cursor = entry.seq + 1;
        }
      }
      this.runPending();
      return 'consumed';
    }

    if (code === RESP_NO_MORE_MESSAGES && bytes.length === 1) {
      this.deviceQueueDrained = true;
      const target = this.inFlight;
      this.inFlight = null;
      if (target) {
        const state = this.clients.get(target);
        if (state) {
          this.deliver(target, bytes);
          state.cursor = this.cache.head();
        }
      }
      const parked = this.pending;
      this.pending = [];
      for (const client of parked) {
        const state = this.clients.get(client);
        if (!state) continue;
        this.deliver(client, NO_MORE_FRAME);
        state.cursor = this.cache.head();
      }
      return 'consumed';
    }

    if (code === PUSH_MSG_WAITING) {
      this.deviceQueueDrained = false;
      // Fall through: hub still fans this out so every client knows to drain.
      return 'fanout';
    }

    return 'fanout';
  }

  // Mirror an outgoing channel send into the inbox cache so other connected
  // clients see "[node-name]: text" as if it were an incoming RECV. The
  // device's own queue is not touched — the cmd still flows to the radio for
  // actual transmission. The originating client's cursor is fast-forwarded
  // past the synthesized entry so it doesn't see a duplicate of its own send.
  //
  // cmd=0x03 layout: [03][flags 1B][chan_idx 1B][ts 4B LE][text...]
  // synthesized 0x11 layout (firmware: companion_radio/MyMesh.cpp
  // onChannelMessageRecv):
  //   [11][snr×4 i8][rsv][rsv][chan_idx][path_len][txt_type][ts 4B LE][text...]
  // path_len=0xFF marks "direct" (firmware uses 0xFF when not a flood).
  private synthesizeChannelSend(client: BridgeClient, payload: Buffer): void {
    const channelIdx = payload[2];
    const tsBytes = payload.subarray(3, 7);
    const textBytes = payload.subarray(7);
    if (textBytes.length === 0) return;

    const senderName = this.nodeName ?? 'me';
    const prefixedText = Buffer.concat([Buffer.from(`${senderName}: `, 'utf8'), textBytes]);

    const synth = Buffer.concat([
      Buffer.from([RESP_CHANNEL_MSG_RECV_V3, 0x00, 0x00, 0x00, channelIdx, 0xff, 0x00]),
      tsBytes,
      prefixedText,
    ]);

    const entry = this.cache.append(synth);
    this.opts.log.trace(
      `synth channel-send seq=${entry.seq} chan_idx=${channelIdx} from ${client.remoteAddr} (size=${this.cache.size()})`,
    );

    // Sender already has the message in its own UI; skip past the echo.
    const senderState = this.clients.get(client);
    if (senderState && senderState.cursor <= entry.seq) {
      senderState.cursor = entry.seq + 1;
    }

    // Wake any other connected client whose cursor is now behind so their
    // MeshCore client issues 0x0a and pulls the synth from the cache.
    for (const [other, state] of this.clients) {
      if (other === client) continue;
      if (state.cursor <= entry.seq) {
        this.deliver(other, PUSH_MSG_WAITING_FRAME);
      }
    }

    // Mirror the send into the desktop UI's message log so this app shows the
    // proxy client's outgoing as an incoming line — same code path the radio
    // RECV handler uses, just sourced from the cmd frame instead.
    this.emitLocalEcho(channelIdx, tsBytes, textBytes, client);

    // Parked clients may now have a cache hit.
    this.runPending();
  }

  private emitLocalEcho(
    channelIdx: number,
    tsBytes: Buffer,
    textBytes: Buffer,
    client: BridgeClient,
  ): void {
    const holder = stateHolder();
    const channel = holder.getChannels().find((c) => c.idx === channelIdx);
    if (!channel) {
      this.opts.log.debug(
        `local echo skipped: no channel for idx=${channelIdx} (from ${client.remoteAddr})`,
      );
      return;
    }
    const tsMs = tsBytes.readUInt32LE(0) * 1000;
    const id = `proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Omit fromPublicKeyHex: the renderer treats that as the "self" marker for
    // own-message styling. Proxy-originated sends still belong to this radio.
    holder.insertMessage({
      id,
      key: channel.key,
      ts: tsMs,
      body: textBytes.toString('utf8'),
      state: 'sent',
    });
    emit.messages(channel.key, holder.getMessagesForKey(channel.key));

    // Track this send for repeat attribution, same as our own channel sends
    // (routes.ts). Repeater relays of the proxy client's message arrive as
    // 0x88 frames at our radio; without a pending registration they can't be
    // matched back and the UI stays stuck at "sent" instead of showing hops.
    const channelHash = channelHashOf(channel);
    if (channelHash != null) {
      registerPendingChannelSend({ messageId: id, channelHash, sentAt: Date.now() });
    }
  }

  private rebindIdentity(client: BridgeClient, appName: string): void {
    const state = this.clients.get(client);
    if (!state) return;
    if (state.appName === appName) return;

    // Persist progress under the old key so a future reconnect under the same
    // identity tuple resumes correctly.
    this.known.set(state.inboxKey, { cursor: state.cursor, lastSeen: Date.now() });

    const newKey = inboxKeyFor(client.remoteIp ?? null, appName);
    state.appName = appName;
    state.inboxKey = newKey;
    const restored = this.lookupKnown(newKey);
    if (restored) state.cursor = restored.cursor;

    this.opts.log.debug(
      `identity ${client.remoteAddr} key=${newKey} cursor=${state.cursor}/${this.cache.head()}`,
    );
    this.maybePromptDrain(client);
  }

  private maybePromptDrain(client: BridgeClient): void {
    const state = this.clients.get(client);
    if (!state) return;
    if (state.cursor >= this.cache.head()) return;
    this.deliver(client, PUSH_MSG_WAITING_FRAME);
    this.opts.log.trace(
      `synthesized PUSH_MSG_WAITING → ${client.remoteAddr} (cursor=${state.cursor}/${this.cache.head()})`,
    );
  }

  private handleGetNext(client: BridgeClient): void {
    const state = this.clients.get(client);
    if (!state) return;

    if (state.cursor < this.cache.oldestSeq()) {
      state.cursor = this.cache.oldestSeq();
    }

    const entry = this.cache.get(state.cursor);
    if (entry) {
      this.deliver(client, entry.bytes);
      state.cursor = entry.seq + 1;
      this.opts.log.trace(
        `cache hit → ${client.remoteAddr} seq=${entry.seq} (cursor=${state.cursor}/${this.cache.head()})`,
      );
      return;
    }

    if (this.deviceQueueDrained) {
      this.deliver(client, NO_MORE_FRAME);
      this.opts.log.trace(`synthesized RESP_NO_MORE_MESSAGES → ${client.remoteAddr}`);
      return;
    }

    if (this.inFlight === null) {
      this.inFlight = client;
      this.opts.log.trace(`drain leader=${client.remoteAddr}; forwarding 0x0a to device`);
      this.opts.forwardToDevice(client, GET_NEXT_FRAME);
      return;
    }

    if (!this.pending.includes(client)) {
      this.pending.push(client);
      this.opts.log.trace(
        `drain park ${client.remoteAddr} (leader=${this.inFlight.remoteAddr}, parked=${this.pending.length})`,
      );
    }
  }

  private runPending(): void {
    if (this.pending.length === 0) return;
    const queue = this.pending;
    this.pending = [];
    for (const client of queue) {
      this.handleGetNext(client);
    }
  }

  private deliver(client: BridgeClient, bytes: Buffer): void {
    try {
      client.send(bytes);
    } catch {
      // The transport layer logs send failures; we just don't propagate.
    }
  }

  private lookupKnown(key: string): KnownClientState | null {
    const entry = this.known.get(key);
    if (!entry) return null;
    if (Date.now() - entry.lastSeen > KNOWN_CLIENT_TTL_MS) {
      this.known.delete(key);
      return null;
    }
    return entry;
  }
}
