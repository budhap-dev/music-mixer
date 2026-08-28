import type { ProjectState } from "../types";
import { getRaw, restoreFile } from "./files";

/**
 * Two ways to keep an arrangement:
 * - IndexedDB autosave (this browser): project state + source audio bytes,
 *   refreshed as the user edits, offered as "Resume" on next visit.
 * - .mixproj files: one portable binary bundling the arrangement and audio —
 *   MIXPRJ01 magic, u32 header length, JSON header, then raw file bytes.
 */

const DB_NAME = "music-mixer";
const MAGIC = "MIXPRJ01";

export interface SavedFile {
  id: string;
  name: string;
  bytes: ArrayBuffer;
}

export interface SavedProject {
  state: ProjectState;
  savedAt: number;
  files: SavedFile[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("meta");
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function autosave(state: ProjectState): Promise<void> {
  const db = await openDb();
  try {
    const ids = [...new Set(state.clips.map((c) => c.fileId))];
    const existing = new Set(
      await done(db.transaction("files").objectStore("files").getAllKeys()),
    );
    const tx = db.transaction(["meta", "files"], "readwrite");
    const files = tx.objectStore("files");
    for (const id of ids) {
      const r = getRaw(id);
      if (r && !existing.has(id)) files.put({ name: r.name, bytes: r.bytes }, id);
    }
    for (const key of existing) if (!ids.includes(key as string)) files.delete(key);
    tx.objectStore("meta").put({ state, savedAt: Date.now() }, "project");
    await finished(tx);
  } finally {
    db.close();
  }
}

/** The autosaved session, or null if there is none / it is incomplete. */
export async function loadSaved(): Promise<SavedProject | null> {
  const db = await openDb();
  try {
    const meta = (await done(
      db.transaction("meta").objectStore("meta").get("project"),
    )) as { state: ProjectState; savedAt: number } | undefined;
    if (!meta?.state?.clips?.length) return null;
    const ids = [...new Set(meta.state.clips.map((c) => c.fileId))];
    const files: SavedFile[] = [];
    for (const id of ids) {
      const rec = (await done(
        db.transaction("files").objectStore("files").get(id),
      )) as { name: string; bytes: ArrayBuffer } | undefined;
      if (!rec) return null; // audio missing: nothing useful to restore
      files.push({ id, name: rec.name, bytes: rec.bytes });
    }
    return { state: meta.state, savedAt: meta.savedAt, files };
  } finally {
    db.close();
  }
}

export async function clearSaved(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(["meta", "files"], "readwrite");
    tx.objectStore("meta").clear();
    tx.objectStore("files").clear();
    await finished(tx);
  } finally {
    db.close();
  }
}

/** Decode a saved/opened project's audio back into the app, return its state. */
export async function restoreProject(p: { state: ProjectState; files: SavedFile[] }): Promise<ProjectState> {
  for (const f of p.files) await restoreFile(f.id, f.name, f.bytes);
  return p.state;
}

/* ---- .mixproj files ---- */

export function exportProjectBlob(state: ProjectState): Blob {
  const ids = [...new Set(state.clips.map((c) => c.fileId))];
  const files = ids.flatMap((id) => {
    const r = getRaw(id);
    return r ? [{ id, name: r.name, bytes: r.bytes }] : [];
  });
  const header = new TextEncoder().encode(
    JSON.stringify({
      state,
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.bytes.byteLength })),
    }),
  );
  const len = new ArrayBuffer(4);
  new DataView(len).setUint32(0, header.byteLength, true);
  return new Blob([MAGIC, len, header, ...files.map((f) => f.bytes)], {
    type: "application/octet-stream",
  });
}

export async function readProjectFile(file: File): Promise<{ state: ProjectState; files: SavedFile[] }> {
  const buf = await file.arrayBuffer();
  if (new TextDecoder().decode(buf.slice(0, 8)) !== MAGIC)
    throw new Error("not a mixproj file");
  const len = new DataView(buf, 8, 4).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(buf.slice(12, 12 + len))) as {
    state: ProjectState;
    files: { id: string; name: string; size: number }[];
  };
  let off = 12 + len;
  const files = header.files.map((f) => {
    const bytes = buf.slice(off, off + f.size);
    off += f.size;
    return { id: f.id, name: f.name, bytes };
  });
  return { state: header.state, files };
}
