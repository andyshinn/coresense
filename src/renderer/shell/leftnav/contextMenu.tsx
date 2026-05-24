import {
  type ContextMenuEntry as BaseContextMenuEntry,
  type ContextMenuItem as BaseContextMenuItem,
  type ContextMenuSeparator as BaseContextMenuSeparator,
  ContextMenu,
} from '../../components/ContextMenu';

/** Single row in an entry context menu — either an actionable item or a divider. */
export type ContextMenuEntry = BaseContextMenuEntry;
export type ContextMenuItem = BaseContextMenuItem;
export type ContextMenuSeparator = BaseContextMenuSeparator;

/** Props for {@link EntryContextMenu}; mirrors the underlying {@link ContextMenu} shape. */
export interface EntryContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

/** Shared portal menu used by ChannelContextMenu and ContactContextMenu in LeftNav. */
export function EntryContextMenu({ x, y, items, onClose }: EntryContextMenuProps) {
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
