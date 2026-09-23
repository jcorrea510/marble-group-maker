import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastOptions {
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface Toast extends ToastOptions {
  id: number;
  message: string;
}

/** Tiny toast notification system ("Added 8 people", "Undo", ...). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = ++counter.current;
      setToasts((list) => [...list.slice(-2), { id, message, ...options }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), options.durationMs ?? 3200));
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  const element = (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return { show, clear, element };
}
