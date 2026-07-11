// Header byte = (version<<6)|(payloadType<<2)|routeType. Route Flood=1, Direct=2.
// PayloadType: TextMessage=2, Ack=3, Advert=4, GroupText=5.

// Flood GroupText, 1 hop. header 0x15 (v0,ptype5,route1) · pathlen 0x01 · path '78'
// · payload: channelHash 2a · mac bbcc · ciphertext 00112233
export const GROUP_TEXT_HEX = '1501782abbcc00112233';

// Direct TextMessage, 0 hops. header 0x0a (v0,ptype2,route2) · pathlen 0x00
// · payload: destHash cb · srcHash e3 · mac 1122 · ciphertext aabbccdd
export const TEXT_MESSAGE_HEX = '0a00cbe31122aabbccdd';

// Direct Ack, 0 hops. header 0x0e (v0,ptype3,route2) · pathlen 0x00 · payload: 4-byte crc
export const ACK_HEX = '0e00deadbeef';
