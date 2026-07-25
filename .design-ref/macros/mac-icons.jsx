// mac-icons.jsx — 16px stroked icon set (lucide-ish), currentColor.
const MacIc = ({ d, size = 16, stroke = 1.6, children, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
);

const MacIcons = {
  braces:   (p) => <MacIc {...p}><path d="M6 2.5c-1.5 0-2 .8-2 2v1.6c0 .9-.5 1.4-1.4 1.4 .9 0 1.4.5 1.4 1.4V10.5c0 1.2.5 2 2 2M10 2.5c1.5 0 2 .8 2 2v1.6c0 .9.5 1.4 1.4 1.4-.9 0-1.4.5-1.4 1.4V10.5c0 1.2-.5 2-2 2" /></MacIc>,
  search:   (p) => <MacIc {...p}><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></MacIc>,
  plus:     (p) => <MacIc {...p}><path d="M8 3v10M3 8h10" /></MacIc>,
  globe:    (p) => <MacIc {...p}><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11" /></MacIc>,
  hash:     (p) => <MacIc {...p}><path d="M5.5 2.5l-1 11M11.5 2.5l-1 11M3 5.5h10.5M2.5 10.5H13" /></MacIc>,
  user:     (p) => <MacIc {...p}><circle cx="8" cy="6" r="2.3" /><path d="M3.5 13a4.5 4.5 0 0 1 9 0" /></MacIc>,
  chevDown: (p) => <MacIc {...p}><path d="M4 6l4 4 4-4" /></MacIc>,
  chevRight:(p) => <MacIc {...p}><path d="M6 4l4 4-4 4" /></MacIc>,
  kebab:    (p) => <MacIc {...p} fill="currentColor" stroke="none"><circle cx="8" cy="3" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="8" cy="13" r="1.3" /></MacIc>,
  trash:    (p) => <MacIc {...p}><path d="M3 4.5h10M6 4.5V3.2c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9V4.5M4.5 4.5l.6 8c0 .6.5 1 1 1h3.8c.6 0 1-.4 1-1l.6-8" /></MacIc>,
  copy:     (p) => <MacIc {...p}><rect x="5.5" y="5.5" width="8" height="8" rx="1.4" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></MacIc>,
  check:    (p) => <MacIc {...p}><path d="M3 8.5l3.2 3.2L13 5" /></MacIc>,
  x:        (p) => <MacIc {...p}><path d="M4 4l8 8M12 4l-8 8" /></MacIc>,
  pencil:   (p) => <MacIc {...p}><path d="M10.5 2.5l3 3L6 13l-3.5.5L3 10z" /></MacIc>,
  reply:    (p) => <MacIc {...p}><path d="M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 3.5 3.5v1.5" /></MacIc>,
  send:     (p) => <MacIc {...p}><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z" /></MacIc>,
  alert:    (p) => <MacIc {...p}><path d="M8 2.2L1.6 13.2h12.8z" /><path d="M8 6.5v3M8 11.3v.1" /></MacIc>,
  info:     (p) => <MacIc {...p}><circle cx="8" cy="8" r="6" /><path d="M8 7.3v3.4M8 5.2v.1" /></MacIc>,
  filter:   (p) => <MacIc {...p}><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.3v-5.3z" /></MacIc>,
  clock:    (p) => <MacIc {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.4" /></MacIc>,
  signal:   (p) => <MacIc {...p}><path d="M2.5 13.5v-2M6 13.5V9M9.5 13.5V6M13 13.5V3" /></MacIc>,
  route:    (p) => <MacIc {...p}><circle cx="3.5" cy="12" r="1.5" /><circle cx="12.5" cy="4" r="1.5" /><path d="M5 12h4a2.5 2.5 0 0 0 2.5-2.5v-3" /></MacIc>,
  eye:      (p) => <MacIc {...p}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></MacIc>,
  bolt:     (p) => <MacIc {...p}><path d="M9 1.5L3.5 9H7l-.5 5.5L12 7H8.5z" /></MacIc>,
  gear:     (p) => <MacIc {...p}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4" /></MacIc>,
  tag:      (p) => <MacIc {...p}><path d="M2.5 7V3.5a1 1 0 0 1 1-1H7l6.5 6.5a1 1 0 0 1 0 1.4l-3.6 3.6a1 1 0 0 1-1.4 0L2.5 7.5z" /><circle cx="5.2" cy="5.2" r="0.7" fill="currentColor" stroke="none" /></MacIc>,
  battery:  (p) => <MacIc {...p}><rect x="2" y="5" width="11" height="6" rx="1.2" /><path d="M14 7v2" /></MacIc>,
  pin:      (p) => <MacIc {...p}><path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.6" /></MacIc>,
  list:     (p) => <MacIc {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" /></MacIc>,
  cornerDown:(p) => <MacIc {...p}><path d="M4 3v4.5A2.5 2.5 0 0 0 6.5 10H13M10 7l3 3-3 3" /></MacIc>,
};

window.MacIcons = MacIcons;
