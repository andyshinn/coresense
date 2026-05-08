import { useEffect, useRef } from 'react';
import type { WsMessage } from '../../shared/types';

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
        try {
          const parsed = JSON.parse(ev.data as string) as WsMessage;
          onMessageRef.current(parsed);
        } catch {
          // ignore malformed
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
