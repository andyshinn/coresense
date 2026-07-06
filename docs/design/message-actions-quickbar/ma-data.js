// ma-data.js — sample thread + emoji / macro sets for the message-action study.
// Plain-JS global (loaded before the Babel scripts). No JSX here.
window.MA_DATA = (function () {
  const owner = {
    name: 'egrme.sh Hand',
    mention: 'egrme.sh',
    pk: 'e7b1 20a4 … 9f3c',
  };

  // A short, realistic channel thread. `role: self` is the operator's own msg.
  const messages = [
    {
      id: 'm1', role: 'other',
      from: 'K5TH', mention: 'K5TH',
      avatar: { glyph: 'K5', hue: 150 },
      pk: 'a3f9 c1d8 … 2b7e',
      time: '08:31 PM', ago: '19m', hops: 2, rssi: -72, snr: 8.4, state: 'acked',
      path: ['SOCO Meshcore RAK', 'Cedar Park Repeater'],
      body: 'Ran the duty-cycle patch overnight — throughput on hop 2 is noticeably cleaner.',
    },
    {
      id: 'm2', role: 'other',
      from: 'RHO 🥦', mention: 'RHO',
      avatar: { glyph: '🥦', hue: 92 },
      pk: '77c4 e0a1 … 5d90', 
      time: '08:43 PM', ago: '3h', hops: 1, rssi: -58, snr: 10.2, state: 'acked',
      path: ['SOCO Meshcore RAK'],
      body: 'got one back!',
    },
    {
      id: 'm3', role: 'self',
      from: 'egrme.sh Hand', mention: 'egrme.sh',
      avatar: { glyph: 'EH', hue: 38 },
      pk: 'e7b1 20a4 … 9f3c',
      time: '08:44 PM', ago: '3h', hops: 0, rssi: null, snr: null, state: 'acked',
      path: [],
      body: "I'm not crying, you're crying!",
    },
    {
      id: 'm4', role: 'other',
      from: 'Ave Maritza-M', mention: 'Ave',
      avatar: { glyph: 'AM', hue: 284 },
      pk: '1f22 9b6d … c418',
      time: '08:52 PM', ago: '2h', hops: 2, rssi: -84, snr: 5.1, state: 'relayed',
      path: ['SOCO Meshcore RAK', 'Bender DT'],
      body: '#meetup — who is bringing spare antennas Saturday? I can cover coax.',
    },
    {
      id: 'm5', role: 'other',
      from: 'Cedar Park Repeater', mention: 'CedarPark',
      avatar: { glyph: 'CP', hue: 200 },
      pk: '4471 a2c9 … 08fe',
      time: '08:58 PM', ago: '41m', hops: 1, rssi: -68, snr: 9.0, state: 'acked',
      path: ['SOCO Meshcore RAK'],
      body: 'Heartbeat — uptime 4d 12h · queue 0 · last fwd 12s ago',
    },
  ];

  // Quick-access reactions shown inline in the toolbar (kept small — airtime-aware).
  const frequent = ['👍', '✅', '📡', '🔋', '😂', '❤️'];

  // Full picker set with search keywords (mesh-flavoured + common).
  const emojis = [
    { e: '👍', k: 'thumbs up yes ok good' },
    { e: '✅', k: 'check ack done confirmed' },
    { e: '📡', k: 'signal antenna repeater satellite' },
    { e: '🔋', k: 'battery power charge' },
    { e: '😂', k: 'laugh funny lol' },
    { e: '❤️', k: 'heart love' },
    { e: '🙏', k: 'thanks pray please appreciate' },
    { e: '👀', k: 'eyes looking watching' },
    { e: '🎉', k: 'party celebrate nice' },
    { e: '🔥', k: 'fire hot great' },
    { e: '💯', k: 'hundred perfect' },
    { e: '🤔', k: 'thinking hmm' },
    { e: '👋', k: 'wave hello hi' },
    { e: '🚀', k: 'rocket launch fast' },
    { e: '🛰️', k: 'satellite orbit space' },
    { e: '🗺️', k: 'map location route' },
    { e: '⚡', k: 'bolt power fast macro' },
    { e: '📍', k: 'pin location marker' },
    { e: '☀️', k: 'sun solar day clear' },
    { e: '🌙', k: 'moon night' },
    { e: '🌧️', k: 'rain weather wet' },
    { e: '💨', k: 'wind fast gust' },
    { e: '🔧', k: 'wrench fix repair tool' },
    { e: '📶', k: 'bars signal reception strength' },
    { e: '🧭', k: 'compass direction bearing' },
    { e: '⏱️', k: 'timer stopwatch eta' },
    { e: '🆗', k: 'ok button okay' },
    { e: '👏', k: 'clap applause nice' },
    { e: '😅', k: 'sweat nervous phew' },
    { e: '🤙', k: 'call shaka hang loose' },
    { e: '🫡', k: 'salute copy roger yes' },
    { e: '❌', k: 'cross no cancel' },
    { e: '⚠️', k: 'warning caution alert' },
    { e: '🔊', k: 'speaker loud volume' },
    { e: '🌡️', k: 'temperature thermometer heat' },
  ];

  // Saved reply macros (roadmap — inserted into the composer for now).
  const macros = [
    { label: 'ACK', text: 'ack ✓ heard you, thanks' },
    { label: 'Copy that', text: 'copy that' },
    { label: 'SNR?', text: 'what SNR are you seeing on your end?' },
    { label: 'Relaying', text: 'relaying now' },
    { label: 'QSY 910.5', text: 'QSY 910.5 MHz' },
    { label: 'ETA', text: 'ETA ~10 min' },
  ];

  return { owner, messages, frequent, emojis, macros };
})();
