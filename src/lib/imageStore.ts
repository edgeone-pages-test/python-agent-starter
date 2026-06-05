/**
 * IndexedDB Image Storage Module (python-starter)
 *
 * Persists tool-generated images (browser screenshots, code_interpreter plot
 * output, etc.) as Blobs. We deliberately keep these out of conversation
 * state for two reasons:
 *
 *   1. Blobs are not JSON-serializable, so they can't ride along in any
 *      snapshot of the message list.
 *   2. The backend never persists base64 to `context.store` either — the
 *      model's tool message only sees `[image:<id>]` placeholders. The IDB
 *      copy is therefore the ONLY long-lived store of the actual pixels.
 *
 * DB name is starter-specific (`python-starter-images-db`) so multiple Makers
 * starters served from the same origin during local dev don't collide.
 */

import { openDatabase } from './idb';

const DB_NAME = 'python-starter-images-db';
const DB_VERSION = 1;
const STORE_NAME = 'images';

export interface StoredImageRecord {
  /** Primary key: `${conversationId}/${imageId}`. */
  storageKey: string;
  conversationId: string;
  /** Owning turnId — best-effort link back to the producing turn for layout. */
  messageId: string;
  imageId: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
  /** Tool that produced this image; used to label the restored row. */
  toolName?: string;
  toolCallId?: string;
}

function openDB(): Promise<IDBDatabase> {
  return openDatabase(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'storageKey' });
      store.createIndex('byConversation', 'conversationId', { unique: false });
      store.createIndex('byMessage', ['conversationId', 'messageId'], { unique: false });
    }
  });
}

/** Convert a base64 string (without data URI prefix) to a Blob. */
export function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
  const byteChars = atob(base64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mimeType });
}

/** Generate a storage key from conversationId and imageId. */
export function makeStorageKey(conversationId: string, imageId: string): string {
  return `${conversationId}/${imageId}`;
}

/** Save an image Blob to IndexedDB. Returns the stored record. */
export async function saveImage(params: {
  conversationId: string;
  messageId: string;
  imageId: string;
  blob: Blob;
  mimeType: string;
  toolName?: string;
  toolCallId?: string;
}): Promise<StoredImageRecord> {
  const { conversationId, messageId, imageId, blob, mimeType, toolName, toolCallId } = params;
  const storageKey = makeStorageKey(conversationId, imageId);

  const record: StoredImageRecord = {
    storageKey,
    conversationId,
    messageId,
    imageId,
    blob,
    mimeType,
    size: blob.size,
    createdAt: Date.now(),
    toolName,
    toolCallId,
  };

  const db = await openDB();
  return new Promise<StoredImageRecord>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/** Load all image records for a given conversationId, sorted by createdAt asc. */
export async function loadConversationImages(conversationId: string): Promise<StoredImageRecord[]> {
  const db = await openDB();
  return new Promise<StoredImageRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('byConversation');
    const req = index.getAll(conversationId);
    req.onsuccess = () => {
      const records = (req.result ?? []) as StoredImageRecord[];
      records.sort((a, b) => a.createdAt - b.createdAt);
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Delete all images belonging to a conversationId. */
export async function deleteConversationImages(conversationId: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('byConversation');
    const req = index.openCursor(conversationId);

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Object URL bookkeeping ──────────────────────────────────────────────────
// Track active object URLs so we can revoke them on conversation reset /
// component unmount and not leak Blob memory on long sessions.

const activeUrls = new Map<string, string>(); // storageKey → objectURL

/** Create or reuse a `blob:` URL for a stored image. Idempotent on storageKey. */
export function createObjectUrl(storageKey: string, blob: Blob): string {
  const existing = activeUrls.get(storageKey);
  if (existing) return existing;

  const url = URL.createObjectURL(blob);
  activeUrls.set(storageKey, url);
  return url;
}

/** Revoke all active object URLs (e.g. on conversation reset). */
export function revokeAllObjectUrls(): void {
  for (const url of activeUrls.values()) {
    URL.revokeObjectURL(url);
  }
  activeUrls.clear();
}
