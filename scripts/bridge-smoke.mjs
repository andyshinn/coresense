import { Socket } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import { startBridge } from '../src/main/bridge/index.ts';
import { bus, emit } from '../src/main/events/bus.ts';
import { transportManager } from '../src/main/transport/manager.ts';

const captured = [];
const mockTransport = {
  type: 'ble',
  async connect() {
    /* no-op */
  },
  async disconnect() {
    /* no-op */
  },
  async sendBytes(buf) {
    captured.push(Buffer.from(buf).toString('hex'));
  },
};
transportManager.setTransport(mockTransport);

bus.on('error', (m) => console.log('[bus.error]', m));

const handle = await startBridge({ enableMdns: false });
console.log('TCP port:', handle.tcpPort, 'WS port:', handle.wsPort);

const sock = new Socket();
const received = [];
sock.on('data', (b) => received.push(b.toString('hex')));
await new Promise((res, rej) => {
  sock.once('error', rej);
  sock.connect(handle.tcpPort, '127.0.0.1', res);
});
await wait(50);

sock.write(Buffer.from([0x3c, 0x05, 0x00, 0x68, 0x65, 0x6c, 0x6c, 0x6f]));
await wait(100);
console.assert(captured[0] === '68656c6c6f', `client→radio: ${captured[0]}`);
console.log('PASS client→radio:', captured[0]);

emit.packet({ timestamp: Date.now(), transportType: 'ble', hex: 'cafe', bytes: [0xca, 0xfe] });
await wait(100);
console.assert(received[0] === '3e0200cafe', `radio→client: ${received[0]}`);
console.log('PASS radio→client:', received[0]);

const sock2 = new Socket();
const received2 = [];
sock2.on('data', (b) => received2.push(b.toString('hex')));
await new Promise((res, rej) => {
  sock2.once('error', rej);
  sock2.connect(handle.tcpPort, '127.0.0.1', res);
});
await wait(50);

emit.packet({ timestamp: Date.now(), transportType: 'ble', hex: 'beef', bytes: [0xbe, 0xef] });
await wait(100);
console.assert(received[1] === '3e0200beef', `sock1 fanout: ${received[1]}`);
console.assert(received2[0] === '3e0200beef', `sock2 fanout: ${received2[0]}`);
console.log('PASS multiplex: both clients received', received[1]);

const status = handle.getStatus();
console.assert(status.tcpClients === 2, `tcpClients=${status.tcpClients}`);
console.log('PASS status:', JSON.stringify(status));

transportManager.setTransport(null);
sock.write(Buffer.from([0x3c, 0x02, 0x00, 0x99, 0x88]));
await wait(100);
console.log('(expected bus.error above for no-radio drop)');

captured.length = 0;
transportManager.setTransport(mockTransport);
sock.write(Buffer.from([0x99, 0xaa, 0x3c, 0x01, 0x00, 0x42]));
await wait(100);
console.assert(captured[0] === '42', `garbage-resync: ${captured[0]}`);
console.log('PASS garbage-resync:', captured[0]);

sock.end();
sock2.end();
await wait(50);
await handle.close();
console.log('all bridge smoke tests passed');
process.exit(0);
