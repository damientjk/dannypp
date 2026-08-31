/**
 * The split view's column proportions, and where they are remembered.
 *
 * Two independently draggable dividers: sidebar | queries | world. Widths are
 * stored as fractions of the window rather than pixels, so a preference set on
 * a big display still makes sense on a laptop.
 *
 * Same defensive read/write as the character-set preference: a browser that
 * refuses localStorage still gets a working layout, just not a remembered one.
 */

export interface SplitLayout {
  /** Sidebar width in px. */
  sidebar: number;
  /** Share of the remaining space given to the queries column, 0..1. */
  queries: number;
}

export const DEFAULT_LAYOUT: SplitLayout = { sidebar: 232, queries: 0.5 };

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
/** Keeps both halves usable: neither can be squeezed past a quarter. */
export const QUERIES_MIN = 0.25;
export const QUERIES_MAX = 0.75;

const STORAGE_KEY = "launchpad.splitLayout";

export function clampLayout(layout: SplitLayout): SplitLayout {
  return {
    sidebar: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(layout.sidebar))),
    queries: Math.min(QUERIES_MAX, Math.max(QUERIES_MIN, layout.queries)),
  };
}

export function loadLayout(): SplitLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<SplitLayout>;
    if (typeof parsed.sidebar !== "number" || typeof parsed.queries !== "number") {
      return DEFAULT_LAYOUT;
    }
    if (!Number.isFinite(parsed.sidebar) || !Number.isFinite(parsed.queries)) {
      return DEFAULT_LAYOUT;
    }
    return clampLayout({ sidebar: parsed.sidebar, queries: parsed.queries });
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: SplitLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A remembered layout is a convenience, never a requirement.
  }
}
