import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { normalizeTripDocument, readTripDocument } from "./document";

export type SyncState = "connecting" | "synced" | "offline";
export type Collaborator = { clientId: number; tripmateId: string; name: string; color: string };

const trackedOrigins = new Set([
  "trip-field",
  "upsert-friend",
  "upsert-expense",
  "remove-expense",
  "upsert-settlement",
  "remove-settlement",
  "add-item",
  "update-item",
  "delete-item",
  "reorder-item",
  "delete-day",
  "calendar-item",
]);

export function useTripDocument(tripId: string) {
  const [document] = useState(() => new Y.Doc());
  const [syncState, setSyncState] = useState<SyncState>("connecting");
  const [hasSynced, setHasSynced] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(
        [
          document.getMap("metadata"),
          document.getMap("items"),
          document.getArray("order"),
          document.getArray("days"),
          document.getMap("friends"),
          document.getMap("expenses"),
          document.getMap("settlements"),
        ],
        { captureTimeout: 500, trackedOrigins },
      ),
    [document],
  );

  useEffect(() => {
    const trimHistory = () => {
      if (undoManager.undoStack.length > 100)
        undoManager.undoStack.splice(0, undoManager.undoStack.length - 100);
    };
    undoManager.on("stack-item-added", trimHistory);
    return () => undoManager.off("stack-item-added", trimHistory);
  }, [undoManager]);

  useEffect(() => {
    const syncUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync`;
    const provider = new HocuspocusProvider({ url: syncUrl, name: tripId, document });
    providerRef.current = provider;
    provider.on("status", ({ status }: { status: string }) => {
      setSyncState(status === "connected" || status === "connecting" ? "connecting" : "offline");
    });
    provider.on("synced", () => {
      normalizeTripDocument(document);
      setSyncState("synced");
      setHasSynced(true);
    });
    let disposed = false;
    let queuedNormalization = false;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === "normalize-document" || queuedNormalization) return;
      queuedNormalization = true;
      queueMicrotask(() => {
        queuedNormalization = false;
        if (!disposed) normalizeTripDocument(document);
      });
    };
    document.on("update", onUpdate);

    const readAwareness = () => {
      const people: Collaborator[] = [];
      provider.awareness?.getStates().forEach((state, clientId) => {
        const user = state.user as
          | { tripmateId?: unknown; name?: unknown; color?: unknown }
          | undefined;
        if (
          typeof user?.tripmateId === "string" &&
          typeof user.name === "string" &&
          typeof user.color === "string"
        ) {
          people.push({
            clientId,
            tripmateId: user.tripmateId,
            name: user.name,
            color: user.color,
          });
        }
      });
      setCollaborators(people);
    };
    provider.awareness?.on("change", readAwareness);
    readAwareness();

    return () => {
      disposed = true;
      document.off("update", onUpdate);
      provider.awareness?.off("change", readAwareness);
      provider.destroy();
      providerRef.current = null;
    };
  }, [document, tripId]);

  const subscribeHistory = useCallback(
    (notify: () => void) => {
      undoManager.on("stack-item-added", notify);
      undoManager.on("stack-item-updated", notify);
      undoManager.on("stack-item-popped", notify);
      undoManager.on("stack-cleared", notify);
      return () => {
        undoManager.off("stack-item-added", notify);
        undoManager.off("stack-item-updated", notify);
        undoManager.off("stack-item-popped", notify);
        undoManager.off("stack-cleared", notify);
      };
    },
    [undoManager],
  );
  const getHistoryState = useCallback(
    () => (undoManager.canUndo() ? 1 : 0) | (undoManager.canRedo() ? 2 : 0),
    [undoManager],
  );
  const historyState = useSyncExternalStore(subscribeHistory, getHistoryState, getHistoryState);

  const subscribe = useCallback(
    (notify: () => void) => {
      document.on("update", notify);
      return () => document.off("update", notify);
    },
    [document],
  );
  const getSnapshot = useCallback(() => JSON.stringify(readTripDocument(document)), [document]);
  const serialized = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const snapshot = useMemo(
    () => JSON.parse(serialized) as ReturnType<typeof readTripDocument>,
    [serialized],
  );
  const setPresenceIdentity = useCallback(
    (identity: { tripmateId: string; name: string; color: string } | null) => {
      providerRef.current?.setAwarenessField("user", identity);
    },
    [],
  );

  return {
    hasSynced,
    document,
    snapshot,
    syncState,
    collaborators,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    canUndo: Boolean(historyState & 1),
    canRedo: Boolean(historyState & 2),
    setPresenceIdentity,
  };
}
