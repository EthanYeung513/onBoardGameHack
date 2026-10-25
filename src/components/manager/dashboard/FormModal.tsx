"use client";

import { useEffect, useRef, useState } from "react";

// In-page form modal in the mockup's `.overlay` / `.modal` / `.field` style — replaces the
// browser-native window.prompt()/confirm() dialogs ("localhost says …").

export type FormField = { name: string; label: string; type?: "text" | "number" | "email"; placeholder?: string; initial?: string; required?: boolean; min?: number };

export function FormModal({
  title,
  sub,
  fields,
  submitLabel,
  danger,
  onSubmit,
  onClose,
}: {
  title: string;
  sub?: string;
  fields: FormField[];
  submitLabel: string;
  danger?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<string | null | void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of fields) {
      const v = values[f.name].trim();
      if (f.required && !v) return setError(`${f.label} is required.`);
      if (f.type === "number" && v && (!Number.isFinite(Number(v)) || Number(v) < (f.min ?? 0))) return setError(`${f.label} must be a number${f.min !== undefined ? ` of at least ${f.min}` : ""}.`);
      if (f.type === "email" && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setError("Enter a valid email address.");
    }
    setBusy(true);
    setError(null);
    const problem = await onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])));
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  }

  return (
    <div className="overlay open" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} noValidate>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h3>{title}</h3>
        {sub && <p className="sub">{sub}</p>}
        {fields.map((f, i) => (
          <div className="field" key={f.name}>
            <label htmlFor={`fm-${f.name}`}>{f.label}</label>
            <input
              id={`fm-${f.name}`}
              ref={i === 0 ? first : undefined}
              type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"}
              min={f.min}
              placeholder={f.placeholder}
              value={values[f.name]}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          </div>
        ))}
        {error && (
          <div className="form-err" role="alert" style={{ display: "block" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? "btn-dark" : "btn-primary"}`} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
