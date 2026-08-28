/** Decoded audio lives outside React state (AudioBuffers aren't serializable). */
const buffers = new Map<string, AudioBuffer>();
// original encoded bytes are kept for autosave / project files (much smaller
// than the decoded PCM)
const raw = new Map<string, { name: string; bytes: ArrayBuffer }>();
let ctx: AudioContext | null = null;

export interface ImportedFile {
  id: string;
  name: string;
  duration: number;
}

async function decodeInto(id: string, name: string, bytes: ArrayBuffer): Promise<AudioBuffer> {
  ctx ??= new AudioContext();
  const buffer = await ctx.decodeAudioData(bytes.slice(0)); // decode detaches its input
  buffers.set(id, buffer);
  raw.set(id, { name, bytes });
  return buffer;
}

export async function importFile(file: File): Promise<ImportedFile> {
  const id = crypto.randomUUID();
  const buffer = await decodeInto(id, file.name, await file.arrayBuffer());
  return { id, name: file.name.replace(/\.[^.]+$/, ""), duration: buffer.duration };
}

/** Re-register a saved file under its original id (session/project restore). */
export const restoreFile = (id: string, name: string, bytes: ArrayBuffer) =>
  decodeInto(id, name, bytes);

export const getBuffer = (id: string) => buffers.get(id);
export const getRaw = (id: string) => raw.get(id);
