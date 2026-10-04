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

const DB_NAME = "cet-swipe";
const DB_VERSION = 1;
const STORE = "word-progress";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllProgress(): Promise<WordProgress[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as WordProgress[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveRecognition(
  id: string,
  status: Extract<LearningStatus, "FAMILIAR" | "UNKNOWN">,
): Promise<WordProgress> {
  const db = await openDb();
  const existing = await new Promise<WordProgress | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(id);
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
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(next);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return next;
}
