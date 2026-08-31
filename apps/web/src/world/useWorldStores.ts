/** React bindings for the two module-level world stores. */

import { useSyncExternalStore } from "react";
import { listEvents, subscribeEvents } from "./eventLog";
import { pendingRequests, subscribeRequests, type AccessRequest } from "./requests";
import type { LogEntry } from "./types";

export function useEventLog(): LogEntry[] {
  return useSyncExternalStore(subscribeEvents, listEvents, listEvents);
}

/** Every pending request, unfiltered. Callers filter by owner themselves. */
export function useRequests(): AccessRequest[] {
  return useSyncExternalStore(subscribeRequests, pendingRequests, pendingRequests);
}
