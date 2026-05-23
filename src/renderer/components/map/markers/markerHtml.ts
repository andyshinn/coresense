import type { Contact } from '../../../../shared/types';
import { MARKER_TYPES, shapeMarkup } from './MarkerShape';

export interface MarkerState {
  selected: boolean;
  faded: boolean;
  stale: boolean;
  showLabel: boolean;
}

const BASE_SIZE = 18;
// Selected markers scale up 1.45x — match the design spec sheet.
const SELECTED_SIZE = Math.round(BASE_SIZE * 1.45);

// Build the imperative DOM element for a single contact marker (Direction A —
// tactical chip). Returns a button so it's keyboard-focusable when MapLibre
// inserts it into the marker layer.
export function buildContactMarker(contact: Contact, state: MarkerState): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', `${contact.name} (${MARKER_TYPES[contact.kind].label})`);
  btn.dataset.contactKey = contact.key;
  btn.className = 'cs-map-marker';

  applyMarkerState(btn, state);
  // textContent on a separate element so contact names containing HTML-
  // significant characters (e.g. <, &) can't break the markup.
  btn.innerHTML = renderMarkerInner(contact.kind, state);
  setLabelText(btn, contact.name);
  return btn;
}

export function applyMarkerState(el: HTMLElement, state: MarkerState): void {
  el.classList.toggle('is-selected', state.selected);
  el.classList.toggle('is-faded', state.faded);
  el.classList.toggle('is-stale', state.stale);
  el.classList.toggle('has-label', state.showLabel);
}

export function syncMarkerVisual(
  el: HTMLElement,
  contact: Contact,
  state: MarkerState,
  prevKind: string | null,
): void {
  applyMarkerState(el, state);
  setLabelText(el, contact.name);
  // Re-render the inner SVG when shape/size or selection-driven size changes.
  // We always re-render on a selection flip so the halo SVG appears/disappears
  // without re-creating the whole marker.
  el.innerHTML = renderMarkerInner(contact.kind, state);
  setLabelText(el, contact.name);
  if (prevKind && prevKind !== contact.kind) {
    el.setAttribute('aria-label', `${contact.name} (${MARKER_TYPES[contact.kind].label})`);
  }
}

function renderMarkerInner(kind: Contact['kind'], state: MarkerState): string {
  const size = state.selected ? SELECTED_SIZE : BASE_SIZE;
  const opacity = state.stale ? 0.5 : 1;
  const halo = state.selected
    ? `<svg class="cs-map-marker__halo" width="${size + 16}" height="${size + 16}" viewBox="0 0 ${size + 16} ${size + 16}" aria-hidden="true">
        <circle cx="${(size + 16) / 2}" cy="${(size + 16) / 2}" r="${(size + 8) / 2}" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.9" />
        <circle cx="${(size + 16) / 2}" cy="${(size + 16) / 2}" r="${(size + 14) / 2}" fill="none" stroke="#f59e0b" stroke-width="1" opacity="0.3" />
      </svg>`
    : '';
  return `
    ${halo}
    <svg class="cs-map-marker__shape" width="${size}" height="${size}" viewBox="0 0 ${BASE_SIZE} ${BASE_SIZE}" aria-hidden="true">
      ${shapeMarkup({ type: kind, size: BASE_SIZE, opacity, dashed: state.stale })}
    </svg>
    <span class="cs-map-marker__label"></span>
  `;
}

function setLabelText(el: HTMLElement, name: string): void {
  const label = el.querySelector<HTMLSpanElement>('.cs-map-marker__label');
  if (label && label.textContent !== name) label.textContent = name;
}
