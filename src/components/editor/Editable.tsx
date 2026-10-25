"use client";

import { useLayoutEffect, useRef } from "react";

// "click any text to edit" (editor.html caption): inline contentEditable text that commits on blur or
// Enter and reverts on Escape or when the commit is rejected. The DOM text is owned here (not by
// React children) so a live-query update never fights the caret.

type Props = {
  value: string;
  /** Resolve true to keep the edit; false reverts to `value`. */
  onCommit: (next: string) => Promise<boolean>;
  className?: string;
  label: string;
  multiline?: boolean;
};

export function Editable({ value, onCommit, className, label, multiline }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.textContent = value;
  }, [value]);

  const reset = () => {
    if (ref.current) ref.current.textContent = value;
  };

  async function commit() {
    const next = (ref.current?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (next === value.trim()) return;
    if (!next) return reset();
    if (!(await onCommit(next))) reset();
  }

  return (
    <span
      ref={ref}
      className={`edt${className ? ` ${className}` : ""}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline={multiline ? true : undefined}
      tabIndex={0}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(multiline && e.shiftKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          reset();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
