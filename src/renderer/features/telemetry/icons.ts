import {
  Battery,
  Binary,
  CircleGauge,
  CircleHelp,
  Cloud,
  Cpu,
  Droplet,
  Gauge,
  type LucideIcon,
  MapPin,
  Mountain,
  Percent,
  Plug,
  Power,
  Ruler,
  Sun,
  Target,
  Thermometer,
  ToggleLeft,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';

// The shared registry and describe() name icons by their lucide-react export
// (strings keep src/shared free of React). An explicit map rather than
// `import * as Icons` keeps the bundle tree-shaken to the icons telemetry uses.
const ICONS: Readonly<Record<string, LucideIcon>> = {
  Battery,
  Binary,
  CircleGauge,
  CircleHelp,
  Cloud,
  Cpu,
  Droplet,
  Gauge,
  MapPin,
  Mountain,
  Percent,
  Plug,
  Power,
  Ruler,
  Sun,
  Target,
  Thermometer,
  ToggleLeft,
  Waves,
  Wind,
  Zap,
};

/** The lucide component for a registry/describe icon name; an unknown name gets `CircleHelp`. */
export function telemetryIcon(name: string): LucideIcon {
  return ICONS[name] ?? CircleHelp;
}

/** Whether `name` is mapped (tests assert every registry icon is). */
export function hasTelemetryIcon(name: string): boolean {
  return name in ICONS;
}
