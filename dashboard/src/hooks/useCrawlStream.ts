import { useEffect, useRef, useState, useCallback } from "react";

export interface StreamEvent {
  id?: string;
  type: string;
  jobId: string;
  url?: string;
  data: Record<string, unknown>;
  ts: string;
}

interface UseCrawlStreamResult {
  events: StreamEvent[];
  connected: boolean;
  clearEvents: () => void;
}

/**
 * Connects to the SSE stream for a crawl job while it is active.
 * Falls back gracefully if EventSource is unavailable.
 * Automatically closes the stream when the job finishes.
 */
export function useCrawlStream(
  jobId: string | undefined,
  isActive: boolean
): UseCrawlStreamResult {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId || !isActive) return;
    if (typeof EventSource === "undefined") return;

    // Close any existing connection before opening a new one
    esRef.current?.close();

    const es = new EventSource(`/v1/crawl/${jobId}/stream?replayLimit=100`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      // SSE comment lines (heartbeat) have no data — skip
      if (!e.data || e.data.startsWith(":")) return;
      try {
        const event = JSON.parse(e.data) as StreamEvent;
        if (event.type === "stream.end") {
          es.close();
          esRef.current = null;
          setConnected(false);
          return;
        }
        setEvents((prev) => {
          const eventId = (event as StreamEvent & { id?: string }).id;
          const duplicate = prev.some((existing) => {
            const existingId = (existing as StreamEvent & { id?: string }).id;
            if (eventId && existingId) return eventId === existingId;
            return (
              existing.type === event.type &&
              existing.jobId === event.jobId &&
              existing.url === event.url &&
              existing.ts === event.ts
            );
          });
          if (duplicate) return prev;

          // Cap at 500 events to avoid unbounded growth
          const next = [...prev, event];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
      // Don't close — browser will attempt to reconnect automatically
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [jobId, isActive]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
