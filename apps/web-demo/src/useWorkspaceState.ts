import { useRef, useState } from "react";
import { loadWorkspace } from "../../../packages/core/storage";
import type { CasePane } from "../../../packages/core/case-command";
import { LOCAL_KIT_TAG } from "../../../packages/core/local-kits";
import { template } from "../../../packages/core/templates";

// Keep bootstrap data out of App's long-lived callbacks and state queue.
// Seed refs are cleared synchronously after lazy state owners take their values.
export function useWorkspaceState(startupNotice: string) {
  const started = useRef(false);
  const seed = useRef<ReturnType<typeof loadWorkspace>>(undefined);
  if (!started.current) {
    seed.current = loadWorkspace();
    started.current = true;
  }
  const store = useState(() => seed.current!.store);
  const workflow = useState(
    () =>
      seed.current!.draft ||
      seed.current!.store.workflows.find(
        (w) => !w.tags.includes(LOCAL_KIT_TAG),
      ) ||
      template(),
  );
  const caseView = useState(() => ({
    id:
      seed
        .current!.store.cases?.filter((c) => !c.archived)
        .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0]?.id ||
      "",
    pane: "overview" as CasePane,
  }));
  const message = useState(() => seed.current!.notice || startupNotice);
  const dirty = useState(
    () =>
      !!seed.current!.draft ||
      !seed.current!.store.workflows.some(
        (w) => !w.tags.includes(LOCAL_KIT_TAG),
      ),
  );
  const blocked = useState(() => seed.current!.blocked);
  seed.current = undefined;
  return { store, workflow, caseView, message, dirty, blocked };
}
