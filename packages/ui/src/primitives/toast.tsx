"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { IconClose } from "../icons/icons";

import styles from "./toast.module.css";

export type ToastTone = "neutral" | "success" | "danger" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss; sticky if 0. */
  duration?: number;
  /**
   * One follow-up the reader can take from the toast itself — "Undo" after a
   * one-click decision. Pressing it runs the handler and dismisses the toast.
   */
  action?: { label: string; onSelect: () => void };
  /**
   * A toast that supersedes the last one in its group instead of stacking.
   * A bidding war fires "Outbid" on every raise; three of them stacked over
   * the purse board are two stale prices and a covered panel. Only the
   * newest is true, so only the newest is shown.
   */
  group?: string;
}

interface ActiveToast extends ToastOptions {
  key: number;
}

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 5000;

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function useToast(): (options: ToastOptions) => void {
  const toast = useContext(ToastContext);
  if (toast === null) {
    throw new Error("useToast requires a <ToastProvider> ancestor");
  }
  return toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((key: number) => {
    setToasts((current) => current.filter((item) => item.key !== key));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const key = counter.current;
      setToasts((current) => {
        const kept =
          options.group === undefined
            ? current
            : current.filter((item) => item.group !== options.group);
        return [...kept.slice(-(MAX_VISIBLE - 1)), { ...options, key }];
      });
      const duration = options.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        setTimeout(() => {
          dismiss(key);
        }, duration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles["region"]} role="status" aria-live="polite" aria-label="Notifications">
        {toasts.map((item) => (
          <div
            key={item.key}
            className={[
              styles["toast"],
              item.tone !== undefined && item.tone !== "neutral" ? styles[item.tone] : undefined,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div>
              <div className={styles["title"]}>{item.title}</div>
              {item.description !== undefined ? <div>{item.description}</div> : null}
            </div>
            {item.action !== undefined ? (
              <button
                type="button"
                className={styles["action"]}
                onClick={() => {
                  item.action?.onSelect();
                  dismiss(item.key);
                }}
              >
                {item.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className={styles["dismiss"]}
              aria-label={`Dismiss: ${item.title}`}
              onClick={() => {
                dismiss(item.key);
              }}
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
