import type { UpdateChannel, UpdateState } from '../../shared/types';

export function computeMode(platform: NodeJS.Platform, channel: UpdateChannel): 'silent' | 'notify' {
  return channel === 'stable' && (platform === 'darwin' || platform === 'win32') ? 'silent' : 'notify';
}

export interface UpdateControllerDeps {
  platform: NodeJS.Platform;
  currentVersion: string;
  getSettings: () => { channel: UpdateChannel; autoCheck: boolean };
  silent: { ensureStarted(): boolean; check(): void; installAndRestart(): void };
  checkNotify: (channel: UpdateChannel, current: string) => Promise<UpdateState>;
  openExternal: (url: string) => void;
  emitState: (s: UpdateState) => void;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (h: ReturnType<typeof setInterval>) => void;
}

const POLL_MS = 60 * 60 * 1000;

export function createUpdateController(deps: UpdateControllerDeps) {
  const initial = deps.getSettings();
  let state: UpdateState = {
    status: 'idle',
    mode: computeMode(deps.platform, initial.channel),
    channel: initial.channel,
    currentVersion: deps.currentVersion,
  };
  let poll: ReturnType<typeof setInterval> | null = null;

  function setState(partial: Partial<UpdateState>): void {
    state = { ...state, ...partial };
    deps.emitState(state);
  }

  function stopPoll(): void {
    if (poll !== null) {
      deps.clearInterval(poll);
      poll = null;
    }
  }

  async function check(): Promise<UpdateState> {
    const { channel } = deps.getSettings();
    const mode = computeMode(deps.platform, channel);
    setState({ status: 'checking', mode, channel });
    if (mode === 'silent') {
      // Status flows back through onSilentState() from autoUpdater events.
      deps.silent.check();
      return state;
    }
    const result = await deps.checkNotify(channel, deps.currentVersion);
    setState(result);
    return state;
  }

  function installAndRestart(): void {
    if (state.mode === 'silent') deps.silent.installAndRestart();
    else if (state.releaseUrl) deps.openExternal(state.releaseUrl);
  }

  function applySettings(): void {
    const { channel, autoCheck } = deps.getSettings();
    const mode = computeMode(deps.platform, channel);
    setState({ mode, channel });
    if (mode === 'silent') {
      stopPoll(); // update-electron-app owns its own interval
      if (autoCheck) deps.silent.ensureStarted();
    } else {
      stopPoll();
      if (autoCheck) poll = deps.setInterval(() => void check(), POLL_MS);
    }
  }

  return {
    start(): void {
      applySettings();
      if (deps.getSettings().autoCheck) void check();
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
