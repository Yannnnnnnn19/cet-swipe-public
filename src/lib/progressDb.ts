export type LearningStatus =
  | "UNSEEN"
  | "FAMILIAR"
  | "UNKNOWN"
  | "LEARNING"
  | "HIGH_RISK"
  | "MASTERED";

export type WordProgress = {
  id: string;
  status: LearningStatus;
  recognitionAttempts: number;
  updatedAt: string;
};

export type SyncConfig = {
  token: string;
  enabled: boolean;
};

const DB_NAME = "cet-swipe";
const DB_VERSION = 2;
const PROGRESS_STORE = "word-progress";
const SETTINGS_STORE = "settings";
const SYNC_CONFIG_KEY = "github-sync-config";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllProgress(): Promise<WordProgress[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROGRESS_STORE, "readonly");
    const request = tx.objectStore(PROGRESS_STORE).getAll();
    request.onsuccess = () => resolve(request.result as WordProgress[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putProgressBatch(records: WordProgress[]): Promise<void> {
  if (!records.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROGRESS_STORE, "readwrite");
    const store = tx.objectStore(PROGRESS_STORE);
    for (const record of records) {
      store.put(record);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function saveRecognition(
  id: string,
  status: Extract<LearningStatus, "FAMILIAR" | "UNKNOWN">,
): Promise<WordProgress> {
  const db = await openDb();
  const existing = await new Promise<WordProgress | undefined>((resolve, reject) => {
    const tx = db.transaction(PROGRESS_STORE, "readonly");
    const request = tx.objectStore(PROGRESS_STORE).get(id);
    request.onsuccess = () => resolve(request.result as WordProgress | undefined);
    request.onerror = () => reject(request.error);
  });

  const next: WordProgress = {
    id,
    status,
    recognitionAttempts: (existing?.recognitionAttempts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROGRESS_STORE, "readwrite");
    tx.objectStore(PROGRESS_STORE).put(next);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return next;
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const request = tx.objectStore(SETTINGS_STORE).get(SYNC_CONFIG_KEY);
    request.onsuccess = () => {
      const row = request.result as { key: string; value: SyncConfig } | undefined;
      resolve(row?.value ?? null);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readwrite");
    tx.objectStore(SETTINGS_STORE).put({ key: SYNC_CONFIG_KEY, value: config });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearSyncConfig(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, "readwrite");
    tx.objectStore(SETTINGS_STORE).delete(SYNC_CONFIG_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
