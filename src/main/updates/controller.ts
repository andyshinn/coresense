import type { UpdateChannel, UpdateState } from '../../shared/types';

export function computeMode(platform: NodeJS.Platform, channel: UpdateChannel): 'silent' | 'notify' {
  return channel === 'stable' && (platform === 'darwin' || platform === 'win32') ? 'silent' : 'notify';
}

export interface UpdateControllerDeps {
  platform: NodeJS.Platform;
  currentVersion: string;
  getSettings: () => { channel: UpdateChannel; autoCheck: boolean };
  silent: { ensureStarted(): boolean; check(): boolean; installAndRestart(): void };
  checkNotify: (channel: UpdateChannel, current: string) => Promise<UpdateState>;
  openExternal: (url: string) => void;
  emitState: (s: UpdateState) => void;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

/** Shown when the silent path can't run (dev/MAS) so the UI doesn't spin on
 *  'checking' forever. */
const SILENT_UNAVAILABLE = 'Automatic updates are only available in packaged builds.';

export function createUpdateController(deps: UpdateControllerDeps) {
  const initial = deps.getSettings();
  let state: UpdateState = {
    status: 'idle',
    mode: computeMode(deps.platform, initial.channel),
    channel: initial.channel,
    currentVersion: deps.currentVersion,
  };

  function setState(partial: Partial<UpdateState>): void {
    state = { ...state, ...partial };
    deps.emitState(state);
  }

  async function check(): Promise<UpdateState> {
    const { channel } = deps.getSettings();
    const mode = computeMode(deps.platform, channel);
    deps.logger.info(`check requested (channel=${channel}, mode=${mode}, current=${deps.currentVersion})`);
    setState({ status: 'checking', mode, channel });
    if (mode === 'silent') {
      // When the check is dispatched, status flows back through onSilentState()
      // from autoUpdater events. When it can't be dispatched (dev/MAS), settle
      // on a terminal state so the UI doesn't spin on 'checking' forever.
      const dispatched = deps.silent.check();
      if (!dispatched) {
        deps.logger.info('silent path unavailable — reporting terminal error state');
        setState({ status: 'error', error: SILENT_UNAVAILABLE });
      }
      return state;
    }
    const result = await deps.checkNotify(channel, deps.currentVersion);
    deps.logger.info(
      `notify result: status=${result.status}${result.latestVersion ? ` latest=${result.latestVersion}` : ''}${result.error ? ` error=${result.error}` : ''}`,
    );
    setState(result);
    return state;
  }

  function installAndRestart(): void {
    deps.logger.info(`installAndRestart requested (mode=${state.mode})`);
    if (state.mode === 'silent') deps.silent.installAndRestart();
    else if (state.releaseUrl) deps.openExternal(state.releaseUrl);
  }

  function applySettings(): void {
    const { channel, autoCheck } = deps.getSettings();
    const mode = computeMode(deps.platform, channel);
    setState({ mode, channel });
    // Silent path (Stable, mac/win): update-electron-app owns its own polling;
    // start it when auto-check is on. Notify path (Development / Linux): NO
    // background polling — it checks once on launch and on demand only, to keep
    // unauthenticated GitHub API usage minimal and avoid rate limits. We
    // deliberately do NOT re-check here on settings changes for the same reason.
    if (mode === 'silent' && autoCheck) deps.silent.ensureStarted();
  }

  return {
    start(): void {
      const s = deps.getSettings();
      deps.logger.info(
        `updates controller starting (channel=${s.channel}, mode=${computeMode(deps.platform, s.channel)}, autoCheck=${s.autoCheck})`,
      );
      applySettings();
      if (s.autoCheck) void check();
    },
    check,
    installAndRestart,
    getState: (): UpdateState => state,
    onSettingsChanged: applySettings,
    onSilentState: (p: Partial<UpdateState>): void => setState(p),
  };
}

export type UpdateController = ReturnType<typeof createUpdateController>;

// Singleton seam (mirrors runtime/appLifecycle): the composition root sets the
// instance; routes/menu/about/server read it. Tests inject a fake.
let instance: UpdateController | null = null;

export function setUpdatesController(c: UpdateController | null): void {
  instance = c;
}

export function updatesController(): UpdateController {
  if (!instance) throw new Error('updates controller not initialized');
  return instance;
}

export function currentUpdateState(): UpdateState {
  return instance ? instance.getState() : { status: 'idle', mode: 'notify', channel: 'stable', currentVersion: '' };
}
