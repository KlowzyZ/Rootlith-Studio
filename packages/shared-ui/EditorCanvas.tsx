import { useEffect, useState } from "react";
import type { Canvas } from "./Canvas";
import type { ComponentProps } from "react";

type CanvasModule = typeof import("./Canvas");
let loaded: CanvasModule | undefined;
let pending: Promise<CanvasModule> | undefined;
function loadCanvas() {
  return (pending ??= import("./Canvas").then(
    (module) => (loaded = module),
    (error: unknown) => {
      pending = undefined; // A failed speculative fetch must not poison Retry.
      throw error;
    },
  ));
}
// Deliberate editor interest only. No startup/idle preloading or hidden canvas.
export function prepareEditor() {
  void loadCanvas().catch(() => {});
}

export function EditorCanvas(props: ComponentProps<typeof Canvas>) {
  const [Component, setComponent] = useState(() => loaded?.Canvas);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!Component) {
      setError("");
      void loadCanvas().then(
        (module) => {
          if (active) setComponent(() => module.Canvas);
        },
        (reason: unknown) => {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : "Canvas could not be loaded.",
            );
        },
      );
    }
    return () => {
      active = false;
    };
  }, [Component, attempt]);
  if (Component) return <Component {...props} />;
  return (
    <div
      className="tool-loading canvas-loading"
      role={error ? "alert" : "status"}
    >
      <strong>
        {error ? "Workflow canvas unavailable" : "Opening workflow canvas…"}
      </strong>
      <p>{error || "Your workspace stays available while the editor loads."}</p>
      {error && (
        <button onClick={() => setAttempt((n) => n + 1)}>Retry canvas</button>
      )}
    </div>
  );
}
