import { describe, expect, it } from 'vitest';
import { type RailData, sectionsFor } from '@/shell/rightrail/sectionsFor';
import type { Channel } from '../../src/shared/types';

const channel: Channel = { key: 'ch:worldcup', name: 'worldcup', kind: 'hashtag' };
const data = (over: Partial<RailData> = {}): RailData => ({
  channel,
  contact: null,
  selectedMessage: null,
  mentionedContact: null,
  repeaters: [],
  repeaterAdminActiveTab: null,
  cardPublicKeyHex: null,
  ...over,
});
const actions = { clearMentionedContact: () => {}, client: null };

describe('sectionsFor channel view', () => {
  it('returns the four channel sections in order', () => {
    const ids = sectionsFor('ch:worldcup', data(), actions).map((s) => s.id);
    expect(ids).toEqual(['rail.channel.info', 'rail.channel.activity', 'rail.channel.people', 'rail.channel.share']);
  });

  it('falls back to a single info section when the channel is missing', () => {
    const ids = sectionsFor('ch:worldcup', data({ channel: null }), actions).map((s) => s.id);
    expect(ids).toEqual(['rail.channel.info']);
  });

  it('defaults Activity/People/Share collapsed', () => {
    const sections = sectionsFor('ch:worldcup', data(), actions);
    const activity = sections.find((s) => s.id === 'rail.channel.activity');
    expect(activity?.defaultOpen).toBe(false);
  });
});
