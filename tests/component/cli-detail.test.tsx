import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CliDetail } from '@/panels/repeater-admin/cli/CliDetail';
import type { CliSuggestion } from '@/panels/repeater-admin/cli/lib/suggest';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';

const radio: CliCommand = {
  name: 'set radio',
  group: 'Radio',
  desc: 'Set the LoRa radio parameters.',
  spec: '<freq>,<bw>,<sf>,<cr>',
  args: [
    { name: 'freq', hint: 'MHz' },
    { name: 'mode', enum: ['fast', 'slow'], enumDesc: { fast: 'SF7', slow: 'SF12' } },
  ],
  key: 'radio',
  def: '869.525,250,11,5',
  reboot: true,
  note: 'Wrong values can strand the node off-frequency.',
};

const cmdItem = (over: Partial<CliSuggestion> = {}): CliSuggestion => ({
  id: 'c:set radio',
  label: 'set radio',
  desc: radio.desc,
  kind: 'command',
  cmd: radio,
  insert: 'set radio',
  replaceFrom: 0,
  ...over,
});

describe('CliDetail — command', () => {
  it('renders name, spec, description, params, default, on-node value, round trip and note', () => {
    render(<CliDetail item={cmdItem()} nodeValue="910.525,250,11,5" roundTripLabel="~2.9 s" />);
    expect(screen.getByText('set radio')).toBeTruthy();
    expect(screen.getByText('<freq>,<bw>,<sf>,<cr>')).toBeTruthy();
    expect(screen.getByText(radio.desc)).toBeTruthy();
    expect(screen.getByText('freq')).toBeTruthy();
    expect(screen.getByText('fast | slow')).toBeTruthy();
    expect(screen.getByText('869.525,250,11,5')).toBeTruthy();
    expect(screen.getByText('910.525,250,11,5')).toBeTruthy();
    expect(screen.getByText('1↑ 1↓ · ~2.9 s')).toBeTruthy();
    expect(screen.getByText(radio.note as string)).toBeTruthy();
  });

  it('renders the no-reply round trip and a dash when the estimate is unknown', () => {
    const noReply: CliCommand = { ...radio, noReply: true, note: undefined };
    render(<CliDetail item={cmdItem({ cmd: noReply })} roundTripLabel={null} />);
    expect(screen.getByText('1↑ · no reply')).toBeTruthy();
  });

  it('omits the on-node row when no value is known', () => {
    render(<CliDetail item={cmdItem()} roundTripLabel="~2.9 s" />);
    expect(screen.queryByText('On node')).toBeNull();
  });
});

describe('CliDetail — value item', () => {
  it('renders label, description and what it resolves to', () => {
    const item: CliSuggestion = {
      id: 'v:fast',
      label: 'fast',
      desc: 'SF7 — fastest, shortest range',
      kind: 'value',
      meta: 'SF7',
      insert: 'fast',
      replaceFrom: 9,
    };
    render(<CliDetail item={item} roundTripLabel={null} />);
    expect(screen.getByText('fast')).toBeTruthy();
    expect(screen.getByText('SF7 — fastest, shortest range')).toBeTruthy();
    expect(screen.getByText('SF7')).toBeTruthy();
  });
});
