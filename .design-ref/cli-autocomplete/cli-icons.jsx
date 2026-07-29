// cli-icons.jsx — line icons, sized to the CoreSense chrome (14px default).
const svg = (children, vb) => function Icon({ size = 14, sw = 1.6, className, style }) {
  return (
    <svg viewBox={vb || '0 0 24 24'} width={size} height={size} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, ...style }} aria-hidden="true">{children}</svg>
  );
};

const CLIIcons = {
  Tower: svg(<><path d="M5 20 12 7l7 13" /><path d="M8.5 15h7" /><path d="M3.5 9a8 8 0 0 1 2-5" /><path d="M20.5 9a8 8 0 0 0-2-5" /></>),
  Login: svg(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></>),
  Branch: svg(<><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="9" r="2.5" /><path d="M6 8.5v7" /><path d="M18 11.5c0 3-3 3.5-6 4" /></>),
  Activity: svg(<path d="M3 12h4l3-8 4 16 3-8h4" />),
  Shield: svg(<><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></>),
  Users: svg(<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5" /><path d="M17.5 14.5A6 6 0 0 1 21 20" /></>),
  ListTree: svg(<><path d="M4 6h16" /><path d="M8 12h12" /><path d="M12 18h8" /></>),
  Terminal: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3" /><path d="M12.5 15H17" /></>),
  Search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  Scroll: svg(<><path d="M5 5a2 2 0 0 1 2-2h9l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M15 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></>),
  Map: svg(<><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" /><path d="M9 4v13" /><path d="M15 6.5v13" /></>),
  Braces: svg(<><path d="M9 3.5c-2 0-2.5 1-2.5 3S6 9.5 4.5 10.5v3C6 14.5 6.5 15.5 6.5 17.5s.5 3 2.5 3" /><path d="M15 3.5c2 0 2.5 1 2.5 3s.5 3 2 4v3c-1.5 1-2 2-2 4s-.5 3-2.5 3" /></>),
  Gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" /></>),
  Bluetooth: svg(<path d="M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5" />),
  Megaphone: svg(<><path d="M3 11v2a1 1 0 0 0 1 1h3l7 5V5L7 10H4a1 1 0 0 0-1 1z" /><path d="M17.5 9a4 4 0 0 1 0 6" /></>),
  Crosshair: svg(<><circle cx="12" cy="12" r="7" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>),
  Pin: svg(<><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
  BellOff: svg(<><path d="M18 8a6 6 0 0 0-9.3-5" /><path d="M6 9v4l-2 3h13" /><path d="M10.5 19a2 2 0 0 0 3.4.4" /><path d="M3 3l18 18" /></>),
  Globe: svg(<><circle cx="12" cy="12" r="8" /><path d="M4 12h16" /><path d="M12 4c2.5 2.6 2.5 12.4 0 16-2.5-3.6-2.5-13.4 0-16z" /></>),
  Hash: svg(<><path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M3.5 15h15" /></>),
  Chevron: svg(<path d="M9 5l7 7-7 7" />),
  ChevronDown: svg(<path d="M5 9l7 7 7-7" />),
  Copy: svg(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>),
  Star: svg(<path d="m12 3.8 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 10l5.9-.9z" />),
  Plus: svg(<><path d="M12 5v14M5 12h14" /></>),
  X: svg(<><path d="M6 6l12 12M18 6L6 18" /></>),
  Grip: svg(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>),
  Panel: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>),
  Building: svg(<><path d="M4 21V6l7-3v18" /><path d="M11 10h9v11" /><path d="M14.5 14h2.5M14.5 17.5h2.5M7 8.5h1M7 12h1M7 15.5h1" /></>),
  Power: svg(<><path d="M12 3v9" /><path d="M6.5 6.5a8 8 0 1 0 11 0" /></>),
  Alert: svg(<><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.4" r=".7" fill="currentColor" /></>),
  Clock: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.2 2" /></>),
  Refresh: svg(<><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>),
  Check: svg(<path d="M4.5 12.5 9.5 17.5 19.5 7" />),
  Radio: svg(<><circle cx="12" cy="12" r="2" /><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8" /><path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>),
  Reply: svg(<><path d="M9 8 4 12.5 9 17" /><path d="M4 12.5h9a6 6 0 0 1 6 6v1" /></>),
  Book: svg(<><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 18.5V21h16" /></>),
  Bolt: svg(<path d="M13 3 5 13.5h5.5L11 21l8-10.5h-5.5z" />),
  Lock: svg(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" /></>),
};

window.CLIIcons = CLIIcons;
