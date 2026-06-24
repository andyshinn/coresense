import { Box, Flex, ScrollArea } from '@radix-ui/themes';
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { cn } from '../../../lib/utils';
import './nav.css';

/**
 * Local Radix nav-shell replacing the shadcn `components/ui/sidebar` primitives
 * (Radix Themes has no sidebar). The component/prop names mirror the shadcn
 * sidebar so the left-nav consumers map 1:1.
 *
 * Only the surface the left-nav actually uses is reproduced. See the task report
 * for the list of shadcn sidebar features intentionally omitted (mobile Sheet,
 * floating/inset variants, SidebarRail drag-resize, cookie persistence, etc.).
 */

type NavState = 'expanded' | 'collapsed';
type SetOpen = (open: boolean | ((open: boolean) => boolean)) => void;

interface NavContextValue {
  /** `'expanded'` (full width) or `'collapsed'` (icon rail). */
  state: NavState;
  /** True when expanded — convenience mirror of `state`. */
  open: boolean;
  /** Expand/collapse the rail. Accepts a boolean or updater fn. */
  setOpen: SetOpen;
}

const NavContext = createContext<NavContextValue | null>(null);

/** ↔ `useSidebar`. Returns `{ state, open, setOpen }`; throws outside a `NavRoot`. */
export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used within a NavRoot.');
  return ctx;
}

interface NavRootProps extends Omit<ComponentProps<typeof Flex>, 'children'> {
  /** Only `'icon'` is supported (collapses to an icon rail). Omit for non-collapsible. */
  collapsible?: 'icon';
  /** Controlled open state. Defaults to uncontrolled, open. */
  open?: boolean;
  /** Fires when the open state should change (controlled mode). */
  onOpenChange?: (open: boolean) => void;
  /** Initial open state in uncontrolled mode. */
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * ↔ `Sidebar`. A `<Flex direction="column">` shell that owns the expand/collapse
 * context and sets `data-collapsible="icon"` (only while collapsed) so the
 * co-located `nav.css` icon-rail rules apply. Width comes from `--sidebar-width`.
 *
 * Wraps children in a Radix `Tooltip.Provider` (delay 0) so `NavButton` tooltips
 * work without a separate provider. Honors a controlled `open`/`onOpenChange`
 * pair so a future AppShell can drive it from the store; otherwise it manages its
 * own state.
 */
export function NavRoot({
  collapsible,
  open: openProp,
  onOpenChange,
  defaultOpen = true,
  className,
  style,
  children,
  ...props
}: NavRootProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;

  const setOpen = useCallback<SetOpen>(
    (value) => {
      const next = typeof value === 'function' ? value(open) : value;
      if (onOpenChange) onOpenChange(next);
      else setOpenState(next);
    },
    [onOpenChange, open],
  );

  const state: NavState = open ? 'expanded' : 'collapsed';

  const ctx = useMemo<NavContextValue>(() => ({ state, open, setOpen }), [state, open, setOpen]);

  // data-collapsible is only present while collapsed (mirrors the shadcn sidebar,
  // which sets it to '' when expanded). nav.css keys off ="icon".
  const collapsedToIcon = collapsible === 'icon' && state === 'collapsed';

  return (
    <NavContext.Provider value={ctx}>
      <Flex
        direction="column"
        data-slot="nav"
        data-state={state}
        data-collapsible={collapsedToIcon ? 'icon' : undefined}
        className={cn('nav-root group', className)}
        style={style as CSSProperties}
        {...props}
      >
        {children}
      </Flex>
    </NavContext.Provider>
  );
}

/** ↔ `SidebarHeader`. Padded column at the top of the rail. */
export function NavHeader({ className, children, ...props }: ComponentProps<typeof Flex>) {
  return (
    <Flex direction="column" gap="2" p="2" data-slot="nav-header" className={className} {...props}>
      {children}
    </Flex>
  );
}

/** ↔ `SidebarFooter`. Padded column pinned to the bottom of the rail. */
export function NavFooter({ className, children, ...props }: ComponentProps<typeof Flex>) {
  return (
    <Flex direction="column" gap="2" p="2" data-slot="nav-footer" className={className} {...props}>
      {children}
    </Flex>
  );
}

/**
 * ↔ `SidebarContent`. The scrollable middle region. Uses a Radix `ScrollArea` and
 * grows to fill the space between header and footer. Adds the `nav-content` class
 * so overflow is hidden while collapsed.
 */
export function NavContent({ className, children, ...props }: ComponentProps<typeof ScrollArea>) {
  return (
    <Box flexGrow="1" minHeight="0" overflow="hidden" data-slot="nav-content" className={cn('nav-content', className)}>
      <ScrollArea scrollbars="vertical" type="hover" style={{ height: '100%' }} {...props}>
        <Flex direction="column" gap="2">
          {children}
        </Flex>
      </ScrollArea>
    </Box>
  );
}

/**
 * ↔ `SidebarRail`. A thin clickable rail along the trailing edge that toggles the
 * collapsed state. The shadcn version supports cursor-affordance + drag-resize;
 * here it is a plain toggle hit-target (drag-resize intentionally omitted — the
 * left-nav only ever clicks it).
 */
export function NavRail({ className, ...props }: ComponentProps<'button'>) {
  const { setOpen } = useNav();
  return (
    <button
      type="button"
      data-slot="nav-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      title="Toggle Sidebar"
      onClick={() => setOpen((o) => !o)}
      className={cn(
        'absolute inset-y-0 right-0 z-20 hidden w-4 translate-x-1/2 cursor-w-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-cs-border sm:flex',
        className,
      )}
      {...props}
    />
  );
}
