import { useEffect, useRef } from 'react';
import type { WsMessage } from '../../shared/types';
import { log } from '../lib/logger';

interface UseWebSocketArgs {
  url: string | null;
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useWebSocket({ url, onMessage, onOpen, onClose }: UseWebSocketArgs) {
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
  }, [onMessage, onOpen, onClose]);

  useEffect(() => {
    if (!url) return;
    let backoffMs = 500;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        backoffMs = 500;
        onOpenRef.current?.();
      });
      socket.addEventListener('message', (ev) => {
        let parsed: WsMessage;
        try {
          parsed = JSON.parse(ev.data as string) as WsMessage;
        } catch (err) {
          log.warn('ws: dropped malformed message', err);
          return;
        }
        // Dispatch outside the parse try: a handler that throws (a store
        // action, the menu handler, notify) is a bug, not malformed input, and
        // used to be swallowed by the same bare catch without a trace.
        try {
          onMessageRef.current(parsed);
        } catch (err) {
          log.error('ws: handler failed', parsed.type, err);
        }
      });
      socket.addEventListener('close', () => {
        onCloseRef.current?.();
        if (stopped) return;
        reconnectTimer = window.setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      });
      socket.addEventListener('error', () => {
        socket?.close();
      });
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [url]);
}
