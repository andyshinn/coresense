import type { CliCommand } from '../../../../shared/repeater-cli/catalog';

export interface CliConfirmBarProps {
  text: string;
  cmd: CliCommand;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CliConfirmBar(_props: CliConfirmBarProps) {
  return null; // fleshed out in Task 6
}
