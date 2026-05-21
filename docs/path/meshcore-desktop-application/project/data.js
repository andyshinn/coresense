window.MESHCORE_DATA = (() => {
  const owner = {
    name: "egrme.sh Hand", pkShort: "1a3d3c6a…590dd5d5",
    freq: "910.525 MHz", sf: "SF7", bw: "62.5 kHz", cr: "4/5",
    txPower: 20, lat: 30.211336, lon: -97.761527, battery: 87, voltage: 4.02,
  };
  const channels = [
    { name: "Public", unread: 0, secret: "8b3387e9…", muted: false },
    { name: "#testing", unread: 2, secret: "cde5e82c…", muted: false },
    { name: "#meshcore", unread: 7, secret: "2fa78a5a…", muted: false, active: true },
    { name: "#meetup", unread: 0, secret: "952e3c11…", muted: false },
    { name: "#backontheroof", unread: 0, secret: "8fa2b987…", muted: true },
    { name: "#bot", unread: 0, secret: "eb50a1bc…", muted: true },
  ];
  const now = 1778190000;
  const contacts = [
    { name: "Mueller Repeater", type: "repeater", pk: "82ab8d34…0fea217d", lastSeen: now-1215, rssi: -78, snr: 8.5, hops: 1, battery: null, voltage: 13.4, lat: 30.29873, lon: -97.69856 },
    { name: "UT1 - AustinMesh.org", type: "repeater", pk: "78cf9ac8…640aeb45", lastSeen: now-11978, rssi: -82, snr: 6.2, hops: 1, battery: null, voltage: 13.1, lat: 30.288934, lon: -97.73603 },
    { name: "UT2 AustinMesh.org", type: "repeater", pk: "c026173b…fa3c96d1", lastSeen: now-11390, rssi: -85, snr: 5.1, hops: 1, battery: null, voltage: 13.1, lat: 30.28897, lon: -97.73636 },
    { name: "Mt. Bonnell 🗻", type: "repeater", pk: "a889e978…0b45d021", lastSeen: now-5036, rssi: -92, snr: 3.4, hops: 2, battery: 78, voltage: 4.01, lat: 30.32077, lon: -97.77335 },
    { name: "Bender DT 🏙️", type: "repeater", pk: "2cbaf738…2bda1634", lastSeen: now-7975, rssi: -88, snr: 4.2, hops: 1, battery: null, voltage: 13.3, lat: 30.26602, lon: -97.74874 },
    { name: "Tarrytown East Solar", type: "repeater", pk: "a1e16cc6…b0f412d14", lastSeen: now-30946, rssi: -94, snr: 2.1, hops: 2, battery: 92, voltage: 4.18, lat: 30.29368, lon: -97.76313 },
    { name: "Wooten Repeater 1w", type: "repeater", pk: "f3031665…b611461", lastSeen: now-4002, rssi: -90, snr: 3.8, hops: 2, battery: null, voltage: 12.9, lat: 30.35397, lon: -97.71908 },
    { name: "🦎Geko EA Repeater", type: "repeater", pk: "15510cb9…ec04b623f", lastSeen: now-237940, rssi: -101, snr: -1.2, hops: 3, battery: 41, voltage: 3.72, lat: 30.282305, lon: -97.709013, stale: true },
    { name: "Digitaino Downtown", type: "repeater", pk: "68eaa25c…41d567b", lastSeen: now-4905, rssi: -76, snr: 9.1, hops: 1, battery: null, voltage: 13.5, lat: 30.26478, lon: -97.74452 },
    { name: "egrme.sh RAK3401", type: "repeater", pk: "42da7493…ac5d8e5", lastSeen: now-33833, rssi: -65, snr: 11.3, hops: 1, battery: null, voltage: 13.6, lat: 30.21128, lon: -97.76145 },
    { name: "Picassoman-B", type: "companion", pk: "4fcd348f…805adaaf", lastSeen: now-152966, rssi: -98, snr: 0.5, hops: 2, battery: 23, voltage: 3.61 },
    { name: "Finkle🦖", type: "companion", pk: "c648b005…1f5222e9", lastSeen: now-2988, rssi: -71, snr: 10.2, hops: 1, battery: 64, voltage: 3.92, lat: 30.293675, lon: -97.763073 },
    { name: "🇺🇸N5PAO🇺🇸", type: "companion", pk: "9e77cd42…7123f2a9", lastSeen: now-287986, rssi: -103, snr: -2.1, hops: 3, battery: 18, voltage: 3.55, stale: true },
    { name: "K5TH", type: "companion", pk: "cd720283…43293e91", lastSeen: now-155303, rssi: -95, snr: 1.8, hops: 2, battery: 71, voltage: 3.96 },
    { name: "xyzw-1 🍔", type: "companion", pk: "f582bb6c…6cc37a8", lastSeen: now-11347, rssi: -84, snr: 5.5, hops: 2, battery: 56, voltage: 3.85 },
    { name: "JWB2", type: "companion", pk: "ee882eab…81476ed1", lastSeen: now-141247, rssi: -99, snr: -0.4, hops: 3, battery: 33, voltage: 3.68 },
    { name: "NotesRoom", type: "room", pk: "17f77bcd…833dfecb", lastSeen: now-307713 },
    { name: "SOCO Room Server🛒", type: "room", pk: "47faa9aa…1c74e9c98", lastSeen: now-72165 },
    { name: "The Pub", type: "room", pk: "ca89afbf…6d36baf", lastSeen: now-11591 },
  ];
  const messages = [
    { id: 1, from: "Bender DT 🏙️", role: "repeater", time: "10:42", body: "Heartbeat — uptime 4d 12h, queue 0, last fwd 12s ago", state: "acked" },
    { id: 2, from: "Finkle🦖", role: "companion", time: "10:48", body: "Anyone running the new firmware on RAK3172? Seeing better SNR after the duty-cycle patch.", state: "acked" },
    { id: 3, from: "K5TH", role: "companion", time: "10:51", body: "Yeah, ran it overnight. Power draw is a touch higher but throughput on hop 2 is noticeably cleaner.", state: "acked", reply: 2 },
    { id: 4, from: "xyzw-1 🍔", role: "companion", time: "11:03", body: "Patch link?", state: "acked" },
    { id: 5, from: "K5TH", role: "companion", time: "11:04", body: "github.com/meshcore/firmware/pull/482 — merged this morning", state: "acked" },
    { id: 6, from: "Finkle🦖", role: "companion", time: "11:09", body: "Going to flash my hilltop node tonight. Will post numbers.", state: "acked" },
    { id: 7, from: "Mt. Bonnell 🗻", role: "repeater", time: "11:15", body: "Heartbeat — uptime 18d 4h, batt 78%, solar OK", state: "acked" },
    { id: 8, from: "🦎Geko EA Repeater", role: "repeater", time: "11:21", body: "⚠ low battery 41% — solar charging slow today, partial cloud cover", state: "relayed" },
    { id: 9, from: "egrme.sh Hand", role: "self", time: "11:32", body: "Repeater check — anyone in Tarrytown copying?", state: "acked" },
    { id: 10, from: "Tarrytown East Solar", role: "repeater", time: "11:33", body: "Heard you direct, RSSI -76, SNR 9.1", state: "acked", reply: 9 },
    { id: 11, from: "Picassoman-B", role: "companion", time: "11:38", body: "Lost contact w/ R_R_1W earlier — anyone seen it advertise today?", state: "acked" },
    { id: 12, from: "Bender DT 🏙️", role: "repeater", time: "11:41", body: "Last advert from R_R_1W was 19h ago. Probably down.", state: "acked", reply: 11 },
    { id: 13, from: "egrme.sh Hand", role: "self", time: "11:55", body: "Heading up to Mt. Bonnell w/ the handheld — anyone want to test SNR from the overlook?", state: "sending" },
  ];
  return { owner, channels, contacts, messages };
})();
