import { Toaster, toast } from 'coresense';
import { useEffect } from 'react';

// Toaster is imperative — toasts are fired via toast(). We render the live
// Toaster and fire a few persistent (duration: Infinity) toasts on mount so the
// card shows the real styled notifications. `toast` is re-exported from the
// bundle (ui-entry.ts) so it shares sonner state with this Toaster instance.
// cfg.overrides.Toaster pins cardMode:single + a viewport.
export function Notifications() {
  useEffect(() => {
    toast.dismiss();
    toast.success('Connected to Ridgeline Repeater', {
      description: 'SNR +9.5 dB · 3 hops',
      duration: Number.POSITIVE_INFINITY,
    });
    toast.warning('Basecamp Node battery low', {
      description: '12% · 3.41 V',
      duration: Number.POSITIVE_INFINITY,
    });
    toast.error('Lost link to Trailhead', { duration: Number.POSITIVE_INFINITY });
  }, []);

  return (
    <div className="h-72 w-96 rounded-lg bg-cs-bg p-4 text-cs-text">
      <Toaster position="top-center" />
    </div>
  );
}
