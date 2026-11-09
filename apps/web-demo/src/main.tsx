import React from "react";
import { createRoot } from "react-dom/client";
import { initializeDesktop } from "../../../packages/core/desktop-client";
import { App } from "./App";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
async function boot() {
  root.render(
    <div className="boot-screen" role="status">
      Opening your workspace…
    </div>,
  );
  try {
    const notice = await initializeDesktop();
    root.render(
      <React.StrictMode>
        <App startupNotice={notice} />
      </React.StrictMode>,
    );
  } catch (e) {
    root.render(
      <div className="boot-screen">
        <h1>Workspace recovery required</h1>
        <p>
          {e instanceof Error
            ? e.message
            : "Native storage could not be opened."}
        </p>
        <p>
          Existing native files have been preserved. No browser simulation was
          substituted.
        </p>
        <button onClick={() => void boot()}>Retry</button>
        <button
          onClick={async () => {
            try {
              await window.fixflow!.exportRecovery();
            } catch (error) {
              root.render(
                <div className="boot-screen">
                  <h1>Recovery export failed</h1>
                  <p>{String(error)}</p>
                  <button onClick={() => void boot()}>Retry startup</button>
                </div>,
              );
            }
          }}
        >
          Export native recovery
        </button>
      </div>,
    );
  }
}
void boot();

import "./workspace.css";
