import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { readTripDocument } from "./document";

export type SyncState = "connecting" | "synced" | "unsynced" | "offline";
export type Collaborator = { clientId: number; name: string; color: string };

const trackedOrigins = new Set([
  "trip-field",
  "add-item",
  "update-item",
  "delete-item",
  "reorder-item",
  "delete-day",
]);

export function useTripDocument(tripId: string) {
  const [document] = useState(() => new Y.Doc());
  const [syncState, setSyncState] = useState<SyncState>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [displayNamePrompt, setDisplayNamePrompt] = useState<string | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(
        [
          document.getMap("metadata"),
          document.getMap("items"),
          document.getArray("order"),
          document.getArray("days"),
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
    const storedName = localStorage.getItem("pacenotes-display-name")?.trim() ?? "";
    const name = /^Editor \d{3}$/.test(storedName) ? "" : storedName;
    if (!name) {
      localStorage.removeItem("pacenotes-display-name");
      setDisplayNamePrompt("");
    }
    const syncUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync`;
    const provider = new HocuspocusProvider({ url: syncUrl, name: tripId, document });
    providerRef.current = provider;
    if (name) provider.setAwarenessField("user", { name, color: collaboratorColor(name) });
    provider.on("status", ({ status }: { status: string }) => {
      setSyncState(
        status === "connected" ? "unsynced" : status === "connecting" ? "connecting" : "offline",
      );
    });
    provider.on("synced", () => setSyncState("synced"));
    document.on("update", (_update, origin) => {
      if (origin !== provider) setSyncState("unsynced");
    });

    const readAwareness = () => {
      const people: Collaborator[] = [];
      provider.awareness?.getStates().forEach((state, clientId) => {
        const user = state.user as { name?: unknown; color?: unknown } | undefined;
        if (typeof user?.name === "string" && typeof user.color === "string") {
          people.push({ clientId, name: user.name, color: user.color });
        }
      });
      setCollaborators(people);
    };
    provider.awareness?.on("change", readAwareness);
    readAwareness();

    return () => {
      provider.awareness?.off("change", readAwareness);
      provider.destroy();
      providerRef.current = null;
    };
  }, [document, tripId]);

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
  const saveDisplayName = () => {
    const name = displayNamePrompt?.trim();
    if (!name) return;
    localStorage.setItem("pacenotes-display-name", name);
    providerRef.current?.setAwarenessField("user", { name, color: collaboratorColor(name) });
    setDisplayNamePrompt(null);
  };

  return {
    document,
    snapshot,
    syncState,
    collaborators,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    canUndo: undoManager.undoStack.length > 0,
    canRedo: undoManager.redoStack.length > 0,
    displayNamePrompt,
    setDisplayNamePrompt,
    saveDisplayName,
  };
}

function collaboratorColor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const palette = ["#3e6796", "#397257", "#946c23", "#8b5578", "#536f8a", "#715f43"];
  return palette[Math.abs(hash) % palette.length] ?? "#3e6796";
}
