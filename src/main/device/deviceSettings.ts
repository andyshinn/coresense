import { errorMessage } from '../../shared/errors';
import type { AutoAddConfig, DeviceIdentity, GpsConfig, RadioSettings, TelemetryPolicy } from '../../shared/types';
import { protocolSession } from '../protocol';
import { kindFlagsForSave, withModeBit } from '../protocol/autoAddMapping';
import { commit } from '../state/commit';
import { stateHolder } from '../state/holder';
import { markRadioTelemetryPolicyKnown, radioTelemetryPolicy } from '../telemetry/policy';
import { transportManager } from '../transport/manager';

/** How a device-settings write ended. `rejected` covers every way the radio
 *  side can fail: a setter that resolved false, one that threw, or a timeout.
 *  The route maps it to a 503. */
export type DeviceWriteResult = { status: 'ok' } | { status: 'rejected'; message: string };

const OK: DeviceWriteResult = { status: 'ok' };

/** meshcore-ts's boolean setters report a refusal or a timeout as `false` with
 *  no reason, so the command name is the message. */
async function expectOk(sent: Promise<boolean>, message: string): Promise<void> {
  if (!(await sent)) throw new Error(message);
}

/** The telemetry policy the RADIO holds, for a write about to re-send it with
 *  CMD_SET_OTHER_PARAMS — never our JSON copy (telemetry/policy.ts): resending
 *  a stale copy is how a policy set elsewhere used to get overwritten. Throws
 *  (a refusal, so a 503) when it can't be read. */
async function radioPolicyOrThrow(): Promise<TelemetryPolicy> {
  const session = protocolSession();
  const policy = await radioTelemetryPolicy(() => session.readTelemetryPolicy());
  if (!policy) throw new Error('telemetry policy not read from the radio yet');
  return policy;
}

/** Run a sequence of radio writes. The first refusal or throw ends it and
 *  becomes the result, so every setter convention reads the same to callers. */
async function radioWrites(run: () => Promise<void>): Promise<DeviceWriteResult> {
  try {
    await run();
    return OK;
  } catch (err) {
    return { status: 'rejected', message: errorMessage(err) };
  }
}

/** Save radio settings. When a radio is attached and `pushToDevice` is true,
 *  this issues CMD_SET_RADIO_PARAMS (+ TX power) and SET_PATH_HASH_MODE and
 *  leaves local state to the radio's own reply, which adapterEvents commits.
 *  When no radio is connected, the values are stored app-side only — the next
 *  handshake will reapply them. */
export async function applyRadioSettings(next: RadioSettings, pushToDevice: boolean): Promise<DeviceWriteResult> {
  if (!pushToDevice || !transportManager.isConnected()) {
    commit.radioSettings(next);
    return OK;
  }
  const session = protocolSession();
  // Only push fields that actually changed. SET_RADIO_PARAMS is split out
  // from SET_PATH_HASH_MODE because they use different opcodes and either
  // panel (Radio or Experimental) may save independently — re-pushing a
  // full unchanged radio-params frame is wasted bandwidth at best and can
  // be rejected by the radio at worst.
  const current = stateHolder().getRadioSettings();
  const radioParamsChanged =
    next.frequencyHz !== current.frequencyHz ||
    next.bandwidthHz !== current.bandwidthHz ||
    next.spreadingFactor !== current.spreadingFactor ||
    next.codingRate !== current.codingRate ||
    next.txPowerDbm !== current.txPowerDbm ||
    next.repeatMode !== current.repeatMode;
  return radioWrites(async () => {
    if (radioParamsChanged) {
      await expectOk(
        session.setRadioParams({
          frequencyHz: next.frequencyHz,
          bandwidthHz: next.bandwidthHz,
          spreadingFactor: next.spreadingFactor,
          codingRate: next.codingRate,
          txPowerDbm: next.txPowerDbm,
          repeatMode: next.repeatMode,
        }),
        'radio rejected SET_RADIO_PARAMS or timed out',
      );
    }
    if (next.pathHashMode !== current.pathHashMode) await session.setPathHashMode(next.pathHashMode);
  });
}

/** Save the advertised identity: name, position, and whether the advert shares
 *  the position. Disconnected, it is an app-only update — useful for staging
 *  before a connect. Connected, each changed field goes to the radio and the
 *  radio's reply updates local state. */
export async function applyDeviceIdentity(patch: Partial<DeviceIdentity>): Promise<DeviceWriteResult> {
  const holder = stateHolder();
  const current = holder.getDeviceIdentity();
  if (!transportManager.isConnected()) {
    commit.deviceIdentity({ ...current, ...patch });
    return OK;
  }
  const session = protocolSession();
  return radioWrites(async () => {
    const shareChanges =
      typeof patch.sharePositionInAdvert === 'boolean' && patch.sharePositionInAdvert !== current.sharePositionInAdvert;
    // A share-position change re-sends the telemetry policy (below). Resolve
    // it first, so a refusal leaves the name and position unapplied too
    // rather than half the save on the radio.
    const policy = shareChanges ? await radioPolicyOrThrow() : null;
    if (typeof patch.name === 'string' && patch.name !== current.name) {
      await expectOk(session.setAdvertName(patch.name), 'SET_ADVERT_NAME rejected by radio');
    }
    if (
      (typeof patch.lat === 'number' && patch.lat !== current.lat) ||
      (typeof patch.lon === 'number' && patch.lon !== current.lon)
    ) {
      const lat = typeof patch.lat === 'number' ? patch.lat : (current.lat ?? 0);
      const lon = typeof patch.lon === 'number' ? patch.lon : (current.lon ?? 0);
      await expectOk(session.setAdvertLatLon(lat, lon), 'SET_ADVERT_LATLON rejected by radio');
    }
    if (policy && typeof patch.sharePositionInAdvert === 'boolean') {
      // sharePositionInAdvert lives in SET_OTHER_PARAMS along with telemetry
      // policy — re-emit the full frame with the RADIO's telemetry values (see
      // radioPolicyOrThrow). The manual-add byte is deliberately omitted so the
      // library resends the value it mirrored from RESP_SELF_INFO: byte 1 of
      // this command is the radio's auto-add master switch, and passing
      // anything else here would reconfigure auto-add as a side effect of
      // saving an advert setting.
      await expectOk(session.setOtherParams(policy, patch.sharePositionInAdvert), 'SET_OTHER_PARAMS rejected by radio');
    }
  });
}

/** Save the auto-add configuration. App-side fields (auto-refresh,
 *  show-pubkeys) are persisted regardless of connection state; the wire flags
 *  only push when connected. */
export async function applyAutoAddConfig(cfg: AutoAddConfig): Promise<DeviceWriteResult> {
  const holder = stateHolder();
  const current = holder.getAutoAddConfig();
  // Everything that decides what goes ON THE WIRE is compared against the
  // library's mirror, never against the holder. The holder is written
  // optimistically below — while disconnected, and even when the radio
  // rejects the frame — so a "did this change?" test against it answers "no"
  // for edits the radio never received, and no later save ever retries them.
  // The mirror only moves when the radio reports a value or a command
  // actually reached the wire. See SessionAdapter.getLibAutoAddConfig.
  const session = transportManager.isConnected() ? protocolSession() : null;
  const onRadio = session?.getLibAutoAddConfig() ?? null;
  // `mode` is the user's edit of manual_add_contacts bit 0. The inbound
  // body's own manualAddContacts is ignored — the panel edits `mode`, not the
  // raw byte.
  const nextManualAdd = withModeBit(onRadio?.manualAddContacts ?? current.manualAddContacts, cfg.mode);
  const next: AutoAddConfig = { ...cfg, manualAddContacts: nextManualAdd };
  // The master switch rides CMD_SET_OTHER_PARAMS with the telemetry policy,
  // which has to be the RADIO's (see applyDeviceIdentity). Resolve it before
  // anything is written: a refusal after the kind flags reached the radio and
  // the holder took the new mode would leave the UI showing a mode whose
  // manual-add bit never went out.
  const modeChanges = onRadio !== null && nextManualAdd !== onRadio.manualAddContacts;
  let policy: TelemetryPolicy | null = null;
  if (modeChanges) {
    try {
      policy = await radioPolicyOrThrow();
    } catch (err) {
      return { status: 'rejected', message: errorMessage(err) };
    }
  }
  commit.autoAddConfig(next);
  if (!session || !onRadio) return OK;

  return radioWrites(async () => {
    const flags = {
      ...kindFlagsForSave(cfg),
      overwriteOldest: cfg.overwriteOldest,
      // Omitting this emits the 2-byte SET, which the firmware's `len >= 3`
      // guard leaves autoadd_max_hops untouched. Send the 3-byte form only
      // when the value differs from the one the radio is holding, so a save
      // can't reset a limit set on the radio itself — and so an edit made
      // while disconnected still goes out on the next connected save.
      radioMaxHops: cfg.radioMaxHops !== onRadio.radioMaxHops ? cfg.radioMaxHops : undefined,
    };
    await expectOk(session.setAutoAddConfig(flags), 'SET_AUTO_ADD_CONFIG rejected by radio');
    // The library's setAutoAddConfig() only encodes the frame — it leaves its
    // own mirror untouched. Write through, or the setOtherParams below re-emits
    // `autoAddConfig` built from a mirror that still holds the PREVIOUS kind
    // flags, and wireSessionEvents persists those right back over the selection
    // this request just saved.
    session.mirrorAutoAddConfig({ ...flags, mode: next.mode, radioMaxHops: next.radioMaxHops });
    // Then the master switch, and only when it actually changes. Order
    // matters: turning bit 0 on before the kind flags land would leave a
    // window where the radio honours the PREVIOUS selection. It also has to
    // be a separate command — the bit lives in CMD_SET_OTHER_PARAMS, which
    // carries the telemetry policy and advert-location policy along with it,
    // so sending it on every save would push those unrelated prefs too.
    if (modeChanges && policy) {
      const share = holder.getDeviceIdentity().sharePositionInAdvert;
      await expectOk(
        session.setOtherParams(policy, share, nextManualAdd),
        'SET_OTHER_PARAMS (auto-add mode) rejected by radio',
      );
    }
  });
}

/** Save a change to the telemetry policy. The radio is the source of truth
 *  (telemetry/policy.ts), and `patch` holds only the fields being changed,
 *  merged onto the radio's value: base/loc/env and multi-acks share one frame,
 *  so a full body built from a stale copy would overwrite the fields it didn't
 *  mean to touch. Connected: read the radio's value first if this connection
 *  hasn't yet (a refusal when it can't), write the radio, and commit only once
 *  it accepted — a rejected write must not leave the UI showing a policy the
 *  radio doesn't hold. Disconnected: an app-side save, which the next
 *  connect's read-back replaces. */
export async function applyTelemetryPolicy(patch: Partial<TelemetryPolicy>): Promise<DeviceWriteResult> {
  if (!transportManager.isConnected()) {
    commit.telemetryPolicy({ ...stateHolder().getTelemetryPolicy(), ...patch });
    return OK;
  }
  return radioWrites(async () => {
    const next = { ...(await radioPolicyOrThrow()), ...patch };
    const share = stateHolder().getDeviceIdentity().sharePositionInAdvert;
    // Third argument omitted on purpose — see applyDeviceIdentity: the library
    // round-trips the radio's own manual-add byte so a telemetry save can't
    // reconfigure auto-add.
    await expectOk(protocolSession().setOtherParams(next, share), 'SET_OTHER_PARAMS rejected by radio');
    markRadioTelemetryPolicyKnown();
    commit.telemetryPolicy(next);
  });
}

/** Save the GPS config. Disconnected, it is stored app-side only. Connected,
 *  local state is left to the library's `gpsConfig` event, which it emits only
 *  once the radio has acked both custom vars — so a refusal leaves the toggle
 *  showing what the radio is actually doing. The firmware refuses `gps` with
 *  ERR_CODE_ILLEGAL_ARG on any board built without GPS support or whose GPS
 *  module wasn't detected at boot. */
export async function applyGpsConfig(cfg: GpsConfig): Promise<DeviceWriteResult> {
  if (!transportManager.isConnected()) {
    commit.gpsConfig(cfg);
    return OK;
  }
  return radioWrites(() =>
    expectOk(
      protocolSession().setGpsConfig(cfg),
      'Radio refused the GPS change. It may have no GPS module, or none was detected at boot.',
    ),
  );
}
