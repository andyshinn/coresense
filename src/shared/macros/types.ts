export type DistanceUnit = 'metric' | 'imperial';

export interface MacroPosition {
  lat: number;
  lon: number;
}

export interface MacroPathHop {
  /** In `hops` this is always 'hop'. `all_hops` also carries 'origin' and 'sink'. */
  kind: 'origin' | 'hop' | 'sink';
  /** Relay hops: the per-hop key prefix as encoded on the wire (1-3 bytes hex,
   *  per the path's hash_mode). Origin/sink in `all_hops`: a lowercased 2-char
   *  slice of the node name — a display label, NOT wire data. */
  short_id: string;
  /** The matching repeater's name, resolved locally from short_id. Null when no
   *  repeater matches or when more than one does. Origin/sink carry the sender /
   *  owner name as supplied by the library. */
  name: string | null;
  /** The matching repeater's full pubkey, same resolution rules as `name`. Never
   *  on the wire — only the prefix is — so this is a local resolution, and null
   *  whenever ambiguous, unknown, or for origin/sink. */
  pk: string | null;
}

export interface MacroPath {
  id: string;
  /** Number of RELAY hops between the sender and us. 0 on a direct path. */
  length: number;
  hash_mode: number;
  final_snr: number;
  /** Relay hops only — the repeaters between the sender and us. Empty on a
   *  direct path. */
  hops: MacroPathHop[];
  /** The full timeline: origin (sender), every relay, then sink (us). */
  all_hops: MacroPathHop[];
}

export interface MacroContext {
  // always available
  my_name: string | null;
  my_callsign: string | null;
  my_id: string | null;
  my_pubkey: string | null;
  my_pos: MacroPosition | null;
  my_battery_mv: number | null;
  my_battery_v: number | null;
  channel: string | null;
  peer_name: string | null;
  peer_id: string | null;
  peer_pos: MacroPosition | null;
  peer_last_seen: number | null;
  peer_rssi: number | null;
  peer_snr: number | null;
  peer_hops: number | null;
  // reply-only
  message_body: string | null;
  msg_time: number | null;
  received_ago: string | null;
  sender_name: string | null;
  sender_id: string | null;
  sender_pos: MacroPosition | null;
  rssi: number | null;
  snr: number | null;
  hops: number | null;
  times_heard: number | null;
  paths: MacroPath[];
}

export type MacroScope = 'global' | 'channel' | 'contact';

export interface MacroTemplate {
  id: string;
  name: string;
  template: string;
  scope: MacroScope;
  channelKey?: string;
  contactKey?: string;
  createdAt: number;
  updatedAt: number;
}

export type MacroVarAvailability = 'always' | 'reply';

export interface MacroVariable {
  name: string;
  description: string;
  type: 'string' | 'number' | 'position' | 'array' | 'boolean';
  example: string;
  available: MacroVarAvailability;
}

export interface MacroFilterDoc {
  name: string;
  description: string;
  signature: string;
  example: string;
}

export interface MacroManifest {
  variables: MacroVariable[];
  filters: MacroFilterDoc[];
}

export type MacroErrorKind = 'parse' | 'unknown-filter' | 'unknown-variable' | 'timeout' | 'render';

export interface MacroError {
  kind: MacroErrorKind;
  message: string;
  name?: string;
  line?: number;
  col?: number;
}

export type RenderResult = { ok: true; text: string } | { ok: false; error: MacroError };
export type ValidateResult = { ok: true } | { ok: false; errors: MacroError[] };

export interface RenderOptions {
  placeholder?: string;
  renderLimit?: number;
}
