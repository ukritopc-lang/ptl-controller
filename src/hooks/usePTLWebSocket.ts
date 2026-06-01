import { useEffect, useRef, useState } from "react";

export type InterruptData = {
  type: "interrupt";
  address: string;
  seq: string;
  numbers: string;
  raw: string;
  timestamp: string;
};

type WsMessage = InterruptData | { type: "connected"; message: string };

const DEFAULT_WS_URL =
  (import.meta.env.VITE_PTL_WS_URL as string | undefined) ??
  "ws://localhost:3001";

export function usePTLWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastInterrupt, setLastInterrupt] = useState<InterruptData | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(DEFAULT_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setIsConnected(true);
      ws.onerror = () => setIsConnected(false);
      ws.onclose = () => {
        setIsConnected(false);
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsMessage;
          if (data.type === "interrupt") setLastInterrupt(data);
        } catch {
          return;
        }
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { isConnected, lastInterrupt };
}
