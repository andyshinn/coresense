// design-sync bundle entry. coresense is an Electron app, not a published
// component library, so there's no dist entry that exports the shadcn/ui
// primitives. This file re-exports the UI layer from src/renderer/components/ui
// so the converter (esbuild) can bundle every export onto window.CoreSenseUI.
// The `@/` alias resolves via tsconfig.json (cfg.tsconfig). Keep in sync with
// cfg.componentSrcMap when components are added/removed.
export * from '@/components/ui/badge';
export * from '@/components/ui/button';
export * from '@/components/ui/checkbox';
export * from '@/components/ui/command';
export * from '@/components/ui/dialog';
export * from '@/components/ui/hover-card';
export * from '@/components/ui/input';
export * from '@/components/ui/kbd';
export * from '@/components/ui/KeyValueRow';
export * from '@/components/ui/label';
export * from '@/components/ui/popover';
export * from '@/components/ui/progress';
export * from '@/components/ui/select';
export * from '@/components/ui/separator';
export * from '@/components/ui/sheet';
export * from '@/components/ui/sidebar';
export * from '@/components/ui/skeleton';
export * from '@/components/ui/slider';
export * from '@/components/ui/sonner';
export * from '@/components/ui/switch';
export * from '@/components/ui/toggle';
export * from '@/components/ui/toggle-group';
export * from '@/components/ui/tooltip';

// sonner's imperative `toast` API — re-exported so previews (and designs) can
// fire toasts that share state with the bundled <Toaster/>. Not a card (not
// PascalCase, not in componentSrcMap); just an importable named export.
export { toast } from 'sonner';
