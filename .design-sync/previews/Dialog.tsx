import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'coresense';

// Rendered open (`open`) so the portalled content is visible statically.
// cfg.overrides.Dialog pins cardMode:single + a viewport sized for the modal.
export function Confirm() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear discovered list</DialogTitle>
          <DialogDescription>
            Delete 14 discovered-only contacts? On-radio contacts are kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete 14</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
