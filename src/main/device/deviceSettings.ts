import { errorMessage } from '../../shared/errors';
import type { AutoAddConfig, DeviceIdentity, GpsConfig, RadioSettings, TelemetryPolicy } from '../../shared/types';
import { protocolSession } from '../protocol';
import { kindFlagsForSave, withModeBit } from '../protocol/autoAddMapping';
import { commit } from '../state/commit';
import { stateHolder } from '../state/holder';
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
    if (typeof patch.sharePositionInAdvert === 'boolean' && patch.sharePositionInAdvert !== current.sharePositionInAdvert) {
      // sharePositionInAdvert lives in SET_OTHER_PARAMS along with telemetry
      // policy — re-emit the full frame with current telemetry values. The
      // manual-add byte is deliberately omitted so the library resends the
      // value it mirrored from RESP_SELF_INFO: byte 1 of this command is the
      // radio's auto-add master switch, and passing anything else here would
      // reconfigure auto-add as a side effect of saving an advert setting.
      await expectOk(
        session.setOtherParams(holder.getTelemetryPolicy(), patch.sharePositionInAdvert),
        'SET_OTHER_PARAMS rejected by radio',
      );
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
    if (nextManualAdd !== onRadio.manualAddContacts) {
      const share = holder.getDeviceIdentity().sharePositionInAdvert;
      await expectOk(
        session.setOtherParams(holder.getTelemetryPolicy(), share, nextManualAdd),
        'SET_OTHER_PARAMS (auto-add mode) rejected by radio',
      );
    }
  });
}

/** Save the telemetry policy locally, then push it when connected. */
export async function applyTelemetryPolicy(policy: TelemetryPolicy): Promise<DeviceWriteResult> {
  commit.telemetryPolicy(policy);
  if (!transportManager.isConnected()) return OK;
  const share = stateHolder().getDeviceIdentity().sharePositionInAdvert;
  // Third argument omitted on purpose — see applyDeviceIdentity: the library
  // round-trips the radio's own manual-add byte so a telemetry save can't
  // reconfigure auto-add.
  return radioWrites(() => expectOk(protocolSession().setOtherParams(policy, share), 'SET_OTHER_PARAMS rejected by radio'));
}

/** Save the GPS config locally, then push it when connected. */
export async function applyGpsConfig(cfg: GpsConfig): Promise<DeviceWriteResult> {
  commit.gpsConfig(cfg);
  if (!transportManager.isConnected()) return OK;
  return radioWrites(() => expectOk(protocolSession().setGpsConfig(cfg), 'GPS custom-var rejected by radio'));
}
