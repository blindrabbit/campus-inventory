import { useEffect, useRef, useCallback, useState } from "react";

/**
 * useSSE — connects to the backend SSE stream for a given inventory + space.
 * Returns the latest event and exposes a handler map for consumer callbacks.
 */
export function useSSE({ inventoryId, spaceId, enabled = true }) {
  const evtSourceRef = useRef(null);
  const [lastEvent, setLastEvent] = useState(null);
  const handlersRef = useRef({});
  const connectionIdRef = useRef(`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  const on = useCallback((eventType, fn) => {
    handlersRef.current[eventType] = fn;
  }, []);

  useEffect(() => {
    if (!enabled || !inventoryId || typeof EventSource === "undefined") {
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "/api";
    const url = `${baseUrl}/events/stream?inventoryId=${inventoryId}&spaceId=${spaceId == null ? "" : spaceId}&connectionId=${connectionIdRef.current}&token=${encodeURIComponent(token)}`;

    const evtSource = new EventSource(url, { withCredentials: true });
    evtSourceRef.current = evtSource;

    evtSource.addEventListener("connected", (e) => {});

    // Catch-all: forward known event types to registered handlers
    const knownEvents = [
      "item_relocated",
      "item_left_space",
      "item_checked",
      "item_unfound",
      "item_unchecked",
      "item_verified",
      "group_relocated",
      "group_left_space",
      "item_restored",
      "batch_checked",
      "batch_unfound",
      "batch_relocated",
      "batch_left_space",
      "space_auto_reverted",
    ];

    knownEvents.forEach((eventType) => {
      evtSource.addEventListener(eventType, (e) => {
        try {
          const data = JSON.parse(e.data);
          setLastEvent({ type: eventType, data });
          if (handlersRef.current[eventType]) {
            handlersRef.current[eventType](data);
          }
        } catch (parseErr) {
          // Silently fail to avoid console noise
        }
      });
    });

    evtSource.addEventListener("error", (e) => {
      if (evtSource.readyState === EventSource.CLOSED) {
        evtSource.close();
      }
    });

    return () => {
      evtSource.close();
      evtSourceRef.current = null;
    };
  }, [inventoryId, spaceId, enabled]);

  return { lastEvent, on, connectionId: connectionIdRef.current };
}
