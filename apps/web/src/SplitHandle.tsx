/**
 * A draggable column divider.
 *
 * Pointer events (not mouse) so a trackpad, a touchscreen and a pen all work,
 * with capture on the handle itself so a fast drag that outruns the cursor does
 * not drop the gesture. Arrow keys move it too — a 6px target is a poor thing
 * to require of anyone, and `role="separator"` with a value makes the position
 * audible to a screen reader.
 */

import { useCallback, useRef } from "react";

export interface SplitHandleProps {
  label: string;
  /** Current position, in whatever unit the caller works in. */
  value: number;
  min: number;
  max: number;
  /** Step for a single arrow-key press. */
  step: number;
  /** Called with a raw candidate value; the caller clamps and stores it. */
  onChange: (value: number) => void;
  /** Turns a pointer x into a candidate value. */
  valueFromPointer: (clientX: number) => number;
  onCommit?: () => void;
  /** Double-click restores the default position. */
  onReset?: () => void;
}

export function SplitHandle({
  label,
  value,
  min,
  max,
  step,
  onChange,
  valueFromPointer,
  onCommit,
  onReset,
}: SplitHandleProps) {
  const dragging = useRef(false);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      onChange(valueFromPointer(event.clientX));
    },
    [onChange, valueFromPointer],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onCommit?.();
    },
    [onCommit],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const delta =
        event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      if (delta === 0) return;
      event.preventDefault();
      onChange(value + delta);
      onCommit?.();
    },
    [onChange, onCommit, step, value],
  );

  return (
    <div
      className="split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => {
        onReset?.();
        onCommit?.();
      }}
    >
      <span className="split-handle-grip" aria-hidden="true" />
    </div>
  );
}
