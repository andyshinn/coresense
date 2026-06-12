import { emit } from '../../events/bus';
import { child } from '../../log';
import { PUSH } from '../codes';
import type { Feature } from '../feature';

const log = child('protocol');

// PUSH_CODE_CONTACTS_FULL (0x90): the radio's contact store is full and a new
// advert could not be auto-added (overwrite-oldest off / all favourites).
export const contactsFullFeature: Feature = {
  handles: [PUSH.CONTACTS_FULL],
  handle: () => {
    log.warn('radio contact store is full');
    emit.error('Radio contact store is full — remove or favourite contacts to make room.');
  },
};
