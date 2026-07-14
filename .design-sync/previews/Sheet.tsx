import {
  Button,
  KeyValueRow,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from 'coresense';

// Rendered open so the slide-in panel + overlay are visible statically.
// cfg.overrides.Sheet pins cardMode:single + a wide viewport.
export function NodeDetails() {
  return (
    <Sheet open>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Ridgeline Repeater</SheetTitle>
          <SheetDescription>Repeater · last heard 2m ago</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <KeyValueRow label="Public key" value="a3f9c1d8…2b7e" mono />
          <KeyValueRow label="Hardware" value="Heltec V3" />
          <KeyValueRow label="Battery" value="87%" />
          <KeyValueRow label="SNR" value="+9.5 dB" mono />
          <KeyValueRow label="Hops" value="3" mono />
        </div>
        <SheetFooter>
          <Button>Send message</Button>
          <Button variant="outline">Trace path</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
