// Header byte = (version<<6)|(payloadType<<2)|routeType. Route Flood=1, Direct=2.
// PayloadType: TextMessage=2, Ack=3, Advert=4, GroupText=5.

// Flood GroupText, 1 hop. header 0x15 (v0,ptype5,route1) · pathlen 0x01 · path '78'
// · payload: channelHash 2a · mac bbcc · ciphertext 00112233
export const GROUP_TEXT_HEX = '1501782abbcc00112233';

// Flood GroupText, 0 hops, REALLY encrypted under GROUP_TEXT_SECRET_HEX (MeshCore's
// public "Public" channel secret). header 0x15 · pathlen 0x00 · channelHash a1 (sha256(key)[0])
// · mac d98d (HMAC-SHA256 over the ciphertext, 32-byte zero-extended key) · 16-byte AES-128-ECB
// ciphertext of: timestamp 1757000000 LE · flags 0x00 · "bob: hello" · NUL.
// Confirmed via @michaelhart/meshcore-decoder: decrypted = {sender:"bob", message:"hello"}.
export const GROUP_TEXT_SECRET_HEX = '8b3387e9c5cdea6ac9e5edbaa115cd72';
export const GROUP_TEXT_ENCRYPTED_HEX = '150011a1d98d77d733ddb47b4c6df3747f925a5107';

// Direct TextMessage, 0 hops. header 0x0a (v0,ptype2,route2) · pathlen 0x00
// · payload: destHash cb · srcHash e3 · mac 1122 · ciphertext aabbccdd
export const TEXT_MESSAGE_HEX = '0a00cbe31122aabbccdd';

// Direct Ack, 0 hops. header 0x0e (v0,ptype3,route2) · pathlen 0x00 · payload: 4-byte crc
export const ACK_HEX = '0e00deadbeef';

// Flood Advert, 0 hops. header 0x11 (v0,ptype4,route1) · pathlen 0x00
// · payload: pubkey(32, 00..1f) · timestamp(4, LE) · signature(64, 0xee ×64)
//   · appData: flags 0x90 (HasLocation|HasName) · lat int32LE c8f01103 (51.5074°)
//   · lon int32LE c80cfeff (-0.1278°) · name "TestNode" (UTF-8, no NUL terminator)
// Confirmed via @michaelhart/meshcore-decoder that this parses as
// appData.hasLocation=true, location={latitude:51.5074, longitude:-0.1278}, name:"TestNode".
export const ADVERT_HEX =
  '1100000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00b95569' +
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' +
  '90c8f01103c80cfeff546573744e6f6465';
