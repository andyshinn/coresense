import { describe, expect, it } from 'vitest';
import { buildContactMarker, syncMarkerVisual } from '../../src/renderer/components/map/markers/markerHtml';

const state = { selected: false, faded: false, stale: false, showLabel: true };
const label = (el: HTMLElement) => el.querySelector('.cs-map-marker__label')?.textContent;

describe('contact marker element', () => {
  it('builds a labelled button for the subject', () => {
    const el = buildContactMarker({ key: 'nb:ab', name: 'Hilltop', kind: 'repeater' }, state);
    expect(el.getAttribute('aria-label')).toBe('Hilltop (Repeater)');
    expect(el.dataset.contactKey).toBe('nb:ab');
    expect(label(el)).toBe('Hilltop');
    expect(el.classList.contains('has-label')).toBe(true);
  });

  it('refreshes the accessible name when a contact is renamed', () => {
    const el = buildContactMarker({ key: 'c:ab', name: 'Old', kind: 'chat' }, state);
    syncMarkerVisual(el, { key: 'c:ab', name: 'New', kind: 'chat' }, state);
    expect(label(el)).toBe('New');
    expect(el.getAttribute('aria-label')).toBe('New (User)');
  });

  it('refreshes the accessible name and state classes on a kind or state change', () => {
    const el = buildContactMarker({ key: 'c:ab', name: 'Node', kind: 'chat' }, state);
    syncMarkerVisual(el, { key: 'c:ab', name: 'Node', kind: 'sensor' }, { ...state, selected: true, stale: true });
    expect(el.getAttribute('aria-label')).toBe('Node (Sensor)');
    expect(el.classList.contains('is-selected')).toBe(true);
    expect(el.classList.contains('is-stale')).toBe(true);
    expect(el.querySelector('.cs-map-marker__halo')).not.toBeNull();
  });

  it('keeps a name with markup characters as text', () => {
    const el = buildContactMarker({ key: 'c:ab', name: '<b>&x', kind: 'chat' }, state);
    syncMarkerVisual(el, { key: 'c:ab', name: '<i>&y', kind: 'chat' }, state);
    expect(label(el)).toBe('<i>&y');
    expect(el.querySelector('i')).toBeNull();
  });
});
