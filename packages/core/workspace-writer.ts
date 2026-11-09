import {
  load,
  save,
  primaryRecord,
  clearRunHistory,
  clearDraft,
  storeSchema,
  type Store,
} from "./storage";
// One queue for all workspace edits. Reducers run against the newest acknowledged
// record, never against a React render captured before another asynchronous save.
export function workspaceWriter(options: {
  expected: { current: string | null | undefined };
  flush: () => Promise<void>;
  committed: (store: Store) => void;
  pending: (count: number) => void;
  failed: (error: Error) => void;
}) {
  let tail = Promise.resolve(),
    count = 0,
    failure: Error | undefined;
  return {
    update(
      reduce: (current: Store) => Store,
      draft?: { id: string; raw: string | null },
      clearHistory = false,
    ): Promise<void> {
      count++;
      options.pending(count);
      const operation = tail.then(async () => {
        if (failure) throw failure;
        // Validation failures are editable; persistence failures freeze this writer
        // until recovery/reload, preserving the previous acknowledged UI state.
        try {
          await options.flush();
        } catch (error) {
          failure = error instanceof Error ? error : Error("Draft save failed");
          options.failed(failure);
          throw failure;
        }
        const next = storeSchema.parse(reduce(load()));
        try {
          const committed = clearHistory
            ? clearRunHistory(next, options.expected.current)
            : (save(next, options.expected.current), next);
          options.expected.current = primaryRecord();
          await options.flush();
          // Keep the recovery journal until the primary write is acknowledged.
          // The raw comparison protects newer edits made during the write.
          if (draft) {
            clearDraft(draft.id, draft.raw);
            await options.flush();
          }
          options.committed(committed);
        } catch (error) {
          failure =
            error instanceof Error ? error : Error("Workspace save failed");
          options.failed(failure);
          throw failure;
        }
      });
      tail = operation
        .catch(() => {})
        .finally(() => {
          count--;
          options.pending(count);
        });
      return operation;
    },
    idle: async () => {
      for (;;) {
        const waiting = tail;
        await waiting;
        if (waiting === tail) break;
      }
      if (failure) throw failure;
    },
  };
}
