import { ArrowRight } from 'lucide-react';
import type { Contact, PathLearnedEvent } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Separator } from '../ui/separator';

interface Props {
  event: PathLearnedEvent | null;
  contact: Contact | null;
  client: ApiClient | null;
  onClose: () => void;
}

function formatHops(hex: string, hashSize: number): string {
  if (!hex) return 'Flood';
  const chunkLen = hashSize * 2;
  const hops: string[] = [];
  for (let i = 0; i + chunkLen <= hex.length; i += chunkLen) {
    hops.push(hex.slice(i, i + chunkLen));
  }
  return hops.length === 0 ? 'Flood' : hops.join(' → ');
}

export function PathLearnedDialog({ event, contact, client, onClose }: Props) {
  const open = event !== null;
  const name = contact?.name ?? event?.contactKey ?? 'this contact';
  const hashSize = event?.newOutPathHashSize ?? 2;
  const newPath = event ? formatHops(event.newOutPathHex, hashSize) : '';
  const oldPath = event ? formatHops(event.previousOutPathHex, hashSize) : '';

  const onKeep = () => {
    if (!event || !client) return;
    // Re-write the previous manual path back to the radio so the auto-learned
    // value gets overwritten. If the previous was empty (flood), reset.
    void (async () => {
      try {
        if (event.previousOutPathHex.length === 0) {
          await api.resetContactPath(client, event.contactKey);
        } else {
          await api.setContactPath(client, event.contactKey, {
            outPathHex: event.previousOutPathHex,
          });
        }
        notify.success('Kept your manual path');
      } catch (err) {
        notify.error(`Failed to restore path: ${(err as Error).message}`, err);
      }
    })();
    onClose();
  };

  const onAccept = () => {
    // The radio + local Contact already reflect the new path; nothing to do
    // beyond closing the dialog.
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Path auto-learned</DialogTitle>
          <DialogDescription>
            A new path to <span className="font-medium text-cs-text">{name}</span> was discovered
            while sending. The path you set manually has been replaced — keep yours or accept the
            new one?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 rounded border border-cs-border bg-cs-bg-2 p-3 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="w-12 text-cs-text-muted">From:</span>
            <span className="font-mono text-cs-text">{oldPath}</span>
          </div>
          <Separator />
          <div className="flex items-center gap-2">
            <ArrowRight size={12} aria-hidden="true" className="text-cs-text-muted" />
            <span className="w-10 text-cs-text-muted">To:</span>
            <span className="font-mono text-cs-text">{newPath}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onKeep}>
            Keep mine
          </Button>
          <Button onClick={onAccept}>Use new path</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
