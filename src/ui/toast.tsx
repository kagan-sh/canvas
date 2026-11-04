import { useEffect, useState } from "react";

type Toast = { id: number; text: string; detail?: string; error: boolean };

let toasts: Toast[] = [];
let nextId = 1;
const subscribers = new Set<() => void>();
const SHOW_MS = 4500;

function push(text: string, error: boolean, detail?: string) {
  const id = nextId++;
  toasts = [...toasts, { id, text, error, ...(detail === undefined ? {} : { detail }) }].slice(-3);
  subscribers.forEach((notify) => notify());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    subscribers.forEach((notify) => notify());
  }, SHOW_MS);
}

export const toast = {
  info: (text: string) => push(text, false),
  error: (text: string, detail?: string) => push(text, true, detail),
};

export function Toasts() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const notify = () => rerender((n) => n + 1);
    subscribers.add(notify);
    return () => void subscribers.delete(notify);
  }, []);
  return (
    <div className="cv-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={t.error ? "cv-toast cv-toast-error" : "cv-toast"}>
          <span>{t.text}</span>
          {t.detail ? <span className="cv-muted">{t.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}
