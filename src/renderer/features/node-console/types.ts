// The My Node console's command model. Companion firmware has no text CLI, so
// every command is defined app-side and runs through the same API calls the
// rest of the app uses.

import type { RadioPatchRequest } from '../../../shared/api/contract';
import type { CliArg } from '../../../shared/repeater-cli/catalog';
import type { DeviceIdentity, DeviceInfo, DeviceStats, RadioLimits, RadioSettings } from '../../../shared/types';

export type NodeCommandGroup = 'Info' | 'Radio' | 'Position' | 'Advert' | 'Identity';

/** What the commands read: the store's mirror of the connected radio. */
export interface ConsoleState {
  connected: boolean;
  deviceInfo: DeviceInfo;
  deviceIdentity: DeviceIdentity;
  radioSettings: RadioSettings;
  radioLimits: RadioLimits;
}

/** What the commands may do. Implemented over lib/api by the console; a
 *  plain object in tests. Each method rejects with the server's message. */
export interface ConsolePort {
  getState(): ConsoleState;
  sendAdvert(flood: boolean): Promise<void>;
  putDeviceIdentity(patch: Partial<DeviceIdentity>): Promise<void>;
  putDeviceRadio(patch: RadioPatchRequest): Promise<void>;
  getDeviceStats(): Promise<DeviceStats>;
  getDeviceClockSecs(): Promise<number>;
  /** Epoch ms on this computer, for clock drift. */
  now(): number;
}

/** A command's output: one or more transcript lines. */
export interface ConsoleOutput {
  lines: string[];
}

export interface NodeCommand {
  /** One or two words, e.g. 'set tx'. The longest name that matches wins. */
  name: string;
  group: NodeCommandGroup;
  desc: string;
  /** Shown in help and as the argument hint, e.g. '<dBm>'. */
  spec?: string;
  args?: CliArg[];
  /** The whole rest of the line is one argument (a name may hold spaces). */
  restArg?: true;
  /** The action in error messages: "<action> failed: <reason>". */
  action: string;
  /** False only for commands that work without a radio. */
  needsRadio: boolean;
  run(port: ConsolePort, args: string[]): Promise<ConsoleOutput>;
}

/** A refusal before anything was sent: bad arguments. Printed as
 *  "<action> failed: <message>" like any other failure. */
export class ConsoleUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsoleUsageError';
  }
}
