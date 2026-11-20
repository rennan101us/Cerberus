import { useCallback, useEffect, useMemo, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { LibraryGame } from "@types";

let sharedDownloadLibrary: LibraryGame[] = [];
let hasLoadedInitialLibrary = false;
let inFlightLibraryPromise: Promise<LibraryGame[]> | null = null;
const librarySubscribers = new Set<(games: LibraryGame[]) => void>();
let globalListenersAttached = false;

function notifyLibrarySubscribers(games: LibraryGame[]) {
  sharedDownloadLibrary = games;
  hasLoadedInitialLibrary = true;
  for (const listener of librarySubscribers) {
    listener(games);
  }
}

async function fetchSharedLibrary(): Promise<LibraryGame[]> {
  if (!IS_DESKTOP) return sharedDownloadLibrary;
  if (inFlightLibraryPromise) return inFlightLibraryPromise;

  inFlightLibraryPromise = globalThis.window.electron
    .getLibrary(true)
    .then((updatedLibrary) => {
      notifyLibrarySubscribers(updatedLibrary);
      return updatedLibrary;
    })
    .finally(() => {
      inFlightLibraryPromise = null;
    });

  return inFlightLibraryPromise;
}

function ensureGlobalLibraryListeners() {
  if (!IS_DESKTOP || globalListenersAttached) return;
  globalListenersAttached = true;

  globalThis.window.electron.onLibraryBatchComplete(() => {
    void fetchSharedLibrary();
  });

  globalThis.window.electron.onDownloadsUpdated(() => {
    void fetchSharedLibrary();
  });

  globalThis.window.addEventListener("library-update", () => {
    void fetchSharedLibrary();
  });
}

export function useLibrary() {
  const [downloadLibrary, setLibrary] = useState<LibraryGame[]>(
    () => sharedDownloadLibrary
  );
  const library = useMemo(
    () => downloadLibrary.filter((game) => !game.isConcealed),
    [downloadLibrary]
  );

  const updateLibrary = useCallback(async () => {
    await fetchSharedLibrary();
  }, []);

  useEffect(() => {
    ensureGlobalLibraryListeners();
    librarySubscribers.add(setLibrary);

    if (!hasLoadedInitialLibrary) {
      void fetchSharedLibrary();
    } else if (downloadLibrary !== sharedDownloadLibrary) {
      setLibrary(sharedDownloadLibrary);
    }

    return () => {
      librarySubscribers.delete(setLibrary);
    };
  }, []);

  return { library, downloadLibrary, updateLibrary };
}
