import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocket } from '@/hooks/useWebSocket';
import { log } from '@/lib/logger';

class FakeSocket {
  static last: FakeSocket | null = null;
  private listeners = new Map<string, ((ev: { data?: unknown }) => void)[]>();
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {}
  emit(type: string, ev: { data?: unknown } = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useWebSocket message dispatch', () => {
  it('drops malformed JSON with a warning and keeps dispatching', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://x/ws', onMessage }));
    FakeSocket.last?.emit('message', { data: '{not json' });
    expect(onMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    FakeSocket.last?.emit('message', { data: JSON.stringify({ type: 'wsClients', payload: { count: 2 } }) });
    expect(onMessage).toHaveBeenCalledWith({ type: 'wsClients', payload: { count: 2 } });
  });

  it('logs a handler that throws instead of swallowing it, and keeps dispatching', () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    const boom = new Error('boom');
    const onMessage = vi.fn().mockImplementationOnce(() => {
      throw boom;
    });
    renderHook(() => useWebSocket({ url: 'ws://x/ws', onMessage }));
    const frame = JSON.stringify({ type: 'wsClients', payload: { count: 1 } });
    FakeSocket.last?.emit('message', { data: frame });
    expect(error).toHaveBeenCalledWith('ws: handler failed', 'wsClients', boom);

    FakeSocket.last?.emit('message', { data: frame });
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it('logs a handler failure on a non-object frame without throwing from the listener', () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    const boom = new Error('boom');
    const onMessage = vi.fn(() => {
      throw boom;
    });
    renderHook(() => useWebSocket({ url: 'ws://x/ws', onMessage }));
    expect(() => FakeSocket.last?.emit('message', { data: 'null' })).not.toThrow();
    expect(error).toHaveBeenCalledWith('ws: handler failed', undefined, boom);
  });
});
