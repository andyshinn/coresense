import { type Flavor, namedFlavor } from '@protomaps/basemaps';

// Coresense palette — warm browns + cream + amber accent, tuned for a
// "field console" aesthetic that doesn't compete with overlay markers.
//
// Derived from @protomaps/basemaps' built-in light/dark flavor and overrides
// the high-signal slots. Anything left untouched falls through to the upstream
// flavor defaults — so we inherit any new slots the schema adds.
//
// Cartography colors are intentionally desaturated: the map should recede so
// mesh-node and path overlays stay readable.
//
// Road class names map to the Protomaps schema: highway > major > minor > link.

// Light flavor — warm parchment. Pairs with app's light theme.
export const coresenseLight: Flavor = {
  ...namedFlavor('light'),

  // Land / background — warm cream tones.
  background: '#f5f1e6',
  earth: '#ede5d2',

  // Water — desaturated cool slate so the warm landcover stays dominant.
  water: '#bcc7cd',
  glacier: '#e0e8eb',

  // Landcover — muted, slightly cool greens so warm land stays dominant.
  park_a: '#dde3cf',
  park_b: '#d4ddc2',
  wood_a: '#d2dbc4',
  wood_b: '#c7d1b6',
  scrub_a: '#dedcc6',
  scrub_b: '#d4d2bd',

  // Built-up — warmer tan blocks for buildings + districts.
  buildings: '#dccfb5',
  hospital: '#ebd9d3',
  school: '#e8e0c8',
  industrial: '#e2dac6',
  pedestrian: '#e9e2cf',
  zoo: '#dde3cf',
  military: '#e0d7c0',

  // Roads — cream/amber fills with warmer casings for the high-tier classes.
  highway: '#fbe6b8',
  highway_casing_late: '#d49a4a',
  highway_casing_early: '#c98c34',
  major: '#fff5d8',
  major_casing_late: '#cba271',
  major_casing_early: '#b4884f',
  minor_a: '#ffffff',
  minor_b: '#fbf6e9',
  minor_casing: '#d6cdb5',
  minor_service: '#f5f1e6',
  minor_service_casing: '#d6cdb5',
  link: '#fbe6b8',
  link_casing: '#cba271',
  other: '#ede5d2',
  railway: '#a39884',
  boundaries: '#9c8d6e',
  pier: '#dccfb5',

  // Bridges — same warm casings as their non-bridge counterparts.
  bridges_highway: '#fbe6b8',
  bridges_highway_casing: '#3a3322',
  bridges_major: '#fff5d8',
  bridges_major_casing: '#3a3322',
  bridges_minor: '#ffffff',
  bridges_minor_casing: '#3a3322',
  bridges_link: '#fbe6b8',
  bridges_link_casing: '#3a3322',
  bridges_other: '#ede5d2',
  bridges_other_casing: '#5c5340',

  // Labels — dark warm brown for legibility on cream, cream haloes to punch
  // through landcover without harsh outlines.
  country_label: '#3a3322',
  state_label: '#3a3322',
  state_label_halo: '#f5f1e6',
  city_label: '#2a2419',
  city_label_halo: '#f5f1e6',
  subplace_label: '#5c5340',
  subplace_label_halo: '#f5f1e6',
  ocean_label: '#5d7480',
  roads_label_major: '#3a3322',
  roads_label_major_halo: '#f5f1e6',
  roads_label_minor: '#5c5340',
  roads_label_minor_halo: '#f5f1e6',
  address_label: '#5c5340',
  address_label_halo: '#f5f1e6',
};

// Dark flavor — warm-dark console. Pairs with app's dark theme.
export const coresenseDark: Flavor = {
  ...namedFlavor('dark'),

  background: '#13110b',
  earth: '#1a1610',

  // Water — deep desaturated slate, warm-leaning.
  water: '#1f2a33',
  glacier: '#2a3540',

  // Landcover — muted dark olive / forest.
  park_a: '#1e2418',
  park_b: '#222a1c',
  wood_a: '#1f261a',
  wood_b: '#262d20',
  scrub_a: '#252217',
  scrub_b: '#2a2719',

  // Built-up — warm browns, tightly clustered so it doesn't feel busy.
  buildings: '#2a2419',
  hospital: '#2e2118',
  school: '#28231a',
  industrial: '#26211a',
  pedestrian: '#221c12',
  zoo: '#1e2418',
  military: '#2a2419',

  // Roads — amber-tinted fills against dark brown. Casings warmer-still.
  highway: '#6b4e22',
  highway_casing_late: '#92400e',
  highway_casing_early: '#7a3608',
  major: '#5c5340',
  major_casing_late: '#7a3e10',
  major_casing_early: '#5c2e0a',
  minor_a: '#3a3322',
  minor_b: '#2e2818',
  minor_casing: '#1a1610',
  minor_service: '#2e2818',
  minor_service_casing: '#1a1610',
  link: '#6b4e22',
  link_casing: '#7a3e10',
  other: '#221c12',
  railway: '#8a8067',
  boundaries: '#a39884',
  pier: '#2a2419',

  bridges_highway: '#6b4e22',
  bridges_highway_casing: '#0c0a06',
  bridges_major: '#5c5340',
  bridges_major_casing: '#0c0a06',
  bridges_minor: '#3a3322',
  bridges_minor_casing: '#0c0a06',
  bridges_link: '#6b4e22',
  bridges_link_casing: '#0c0a06',
  bridges_other: '#221c12',
  bridges_other_casing: '#0c0a06',

  // Labels — cream / tan against the dark, very dark haloes.
  country_label: '#f5f1e6',
  state_label: '#c1b291',
  state_label_halo: '#0c0a06',
  city_label: '#f5f1e6',
  city_label_halo: '#0c0a06',
  subplace_label: '#a39884',
  subplace_label_halo: '#0c0a06',
  ocean_label: '#8a99a3',
  roads_label_major: '#e2dac1',
  roads_label_major_halo: '#0c0a06',
  roads_label_minor: '#a39884',
  roads_label_minor_halo: '#0c0a06',
  address_label: '#8a8067',
  address_label_halo: '#0c0a06',
};

export function coresenseFlavor(theme: 'light' | 'dark'): Flavor {
  return theme === 'dark' ? coresenseDark : coresenseLight;
}

/** Warm hillshade tint that fits both flavors better than pure black/white. */
export function hillshadeColors(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? { shadow: '#0c0a06', highlight: '#f59e0b', exaggeration: 0.4 }
    : { shadow: '#3a3322', highlight: '#f5f1e6', exaggeration: 0.45 };
}
