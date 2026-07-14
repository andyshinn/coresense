import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from 'coresense';

// Rendered open (defaultOpen) with position="popper" so the listbox shows its
// options below the trigger. cfg.overrides.Select pins cardMode:single + a
// viewport tall enough for the open dropdown.
export function HardwareModel() {
  return (
    <div className="flex justify-center rounded-lg bg-cs-bg p-6 text-cs-text">
      <Select defaultOpen defaultValue="heltec">
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Select hardware" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectLabel>Hardware</SelectLabel>
            <SelectItem value="heltec">Heltec V3</SelectItem>
            <SelectItem value="rak">RAK4631</SelectItem>
            <SelectItem value="tbeam">LILYGO T-Beam</SelectItem>
            <SelectItem value="station">Station G2</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
