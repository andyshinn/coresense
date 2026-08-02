import { describe, expect, it } from 'vitest';
import { summarizeContactSync } from '../../../src/main/events/bus';

// `complete` is what decides between an info line and a "sync INCOMPLETE"
// warning, so both branches need coverage. Driving the false branch through a
// real session would require a genuine dropped-contact bug, hence the pure
// helper.

describe('summarizeContactSync', () => {
  it('is complete when everything the radio delivered was stored', () => {
    expect(summarizeContactSync(198, 198, 198)).toEqual({
      delivered: 198,
      stored: 198,
      onRadio: 198,
      complete: true,
    });
  });

  it('is INCOMPLETE when fewer contacts were stored than delivered', () => {
    expect(summarizeContactSync(300, 141, 141).complete).toBe(false);
  });

  it('is complete when more is stored than this sync delivered', () => {
    // A placeholder contact synthesised for an incoming DM inflates `stored`
    // without the radio having delivered it. That is not a dropped contact.
    expect(summarizeContactSync(198, 199, 198).complete).toBe(true);
  });

  it('is complete for an empty sync', () => {
    expect(summarizeContactSync(0, 0, 0).complete).toBe(true);
  });
});
