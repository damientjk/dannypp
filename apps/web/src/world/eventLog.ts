/**
 * The security log, lifted out of WorldView.
 *
 * It used to be `useState` inside the world view, which was fine while that
 * view was the only thing that could grant or deny. The Playground now carries
 * the same request queue, so a decision made beside the composer has to land in
 * the same log the world panel renders — otherwise the audit trail depends on
 * which half of the screen you clicked, which is exactly the property this
 * whole demo is trying to prove it does not have.
 */

import type { LogEntry } from "./types";

let entries: LogEntry[] = [];

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Newest first, and stable between mutations (useSyncExternalStore needs it). */
export function listEvents(): LogEntry[] {
  return entries;
}

export function appendEvent(entry: LogEntry): void {
  entries = [entry, ...entries];
  for (const listener of listeners) listener();
}

export function resetEvents(): void {
  entries = [];
  for (const listener of listeners) listener();
}
