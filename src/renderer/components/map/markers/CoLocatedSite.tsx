import type { SiteGroup } from './cluster';
import { MARKER_TYPES, shapeMarkup } from './MarkerShape';

// Renders the horizontal chip-row used when ≥2 contacts share a precise
// location (within `MapSettings.coLocationMeters`). A thin amber leader line
// drops from the chip row down to the geographic anchor point so the user can
// see "these N nodes are exactly here." Selected = halo around the row.
export function buildCoLocatedSiteMarker(site: SiteGroup, selected: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-map-site';
  if (selected) btn.classList.add('is-selected');
  btn.dataset.siteKey = site.key;
  btn.setAttribute('aria-label', `Co-located site: ${site.members.map((m) => m.name).join(', ')}`);
  btn.innerHTML = siteMarkup(site);
  return btn;
}

function siteMarkup(site: SiteGroup): string {
  const chipSize = 14;
  const chips = site.members
    .map((m) => {
      // Outer chip box; the shape sits inside a slightly larger color-tinted
      // chip so users can see both shape and color at a glance.
      const meta = MARKER_TYPES[m.kind];
      return `<span class="cs-map-site__chip" style="--marker-color:${meta.color}" title="${escapeAttr(m.name)}">
        <svg width="${chipSize}" height="${chipSize}" viewBox="0 0 ${chipSize} ${chipSize}" aria-hidden="true">
          ${shapeMarkup({ type: m.kind, size: chipSize })}
        </svg>
      </span>`;
    })
    .join('');
  return `
    <span class="cs-map-site__row">${chips}</span>
    <svg class="cs-map-site__leader" width="2" height="22" viewBox="0 0 2 22" aria-hidden="true">
      <line x1="1" y1="0" x2="1" y2="22" stroke="#f59e0b" stroke-width="1" opacity="0.7" />
    </svg>
    <span class="cs-map-site__anchor" aria-hidden="true"></span>
  `;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
