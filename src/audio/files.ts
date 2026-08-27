/** Decoded audio lives outside React state (AudioBuffers aren't serializable). */
const buffers = new Map<string, AudioBuffer>();
let ctx: AudioContext | null = null;

export interface ImportedFile {
  id: string;
  name: string;
  duration: number;
}

export async function importFile(file: File): Promise<ImportedFile> {
  ctx ??= new AudioContext();
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const id = crypto.randomUUID();
  buffers.set(id, buffer);
  return { id, name: file.name.replace(/\.[^.]+$/, ""), duration: buffer.duration };
}

export const getBuffer = (id: string) => buffers.get(id);
