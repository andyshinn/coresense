import { toast } from 'sonner';
import { log } from './logger';
import { useStore } from './store';

function toastOptions(): { duration: number } | undefined {
  const { enabled, durationSec } = useStore.getState().appSettings.toasts;
  if (!enabled) return undefined;
  return { duration: Math.max(1, durationSec) * 1000 };
}

export const notify = {
  error(msg: string, err?: unknown) {
    log.error(msg, err);
    const opts = toastOptions();
    if (opts) toast.error(msg, opts);
  },
  success(msg: string) {
    log.info(msg);
    const opts = toastOptions();
    if (opts) toast.success(msg, opts);
  },
  info(msg: string) {
    log.info(msg);
    const opts = toastOptions();
    if (opts) toast(msg, opts);
  },
};
