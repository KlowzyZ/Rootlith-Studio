import { useEffect, useRef } from "react";
export function useDialog(close: () => void, busy = false) {
  const ref = useRef<HTMLElement>(null);
  const callbacks = useRef({ close, busy });
  callbacks.current = { close, busy };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const items = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ).filter((el) => !el.closest("fieldset:disabled"));
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!callbacks.current.busy) callbacks.current.close();
      }
      if (e.key === "Tab") {
        const elements = items(),
          first = elements[0],
          last = elements.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (!elements.includes(document.activeElement as HTMLElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener("keydown", key);
    return () => {
      dialog.removeEventListener("keydown", key);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return ref;
}
