import type { LucideIcon } from 'lucide-react';
import { Activity, DoorOpen, Globe, Hash, Lock, MessageCircle, Radio } from 'lucide-react';
import type { ChannelKind, ContactKind } from '../../shared/types';

// Shared lucide iconography for conversations, so the LeftNav rows and the
// Unreads panel cards stay visually consistent.
export const CHANNEL_ICON: Record<ChannelKind, LucideIcon> = {
  public: Globe,
  hashtag: Hash,
  private: Lock,
};

export const CONTACT_ICON: Record<ContactKind, LucideIcon> = {
  chat: MessageCircle,
  repeater: Radio,
  sensor: Activity,
  room: DoorOpen,
};
