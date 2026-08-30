// Generates the synthetic audio fixtures the e2e suites use, into ./fixtures.
import { mkdirSync, writeFileSync } from "node:fs";

const dir = new URL("./fixtures/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const sr = 44100;

function wav(name, secs, ch, sample) {
  const n = sr * secs, dataSize = n * ch * 2;
  const b = Buffer.alloc(44 + dataSize);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataSize, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(ch, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const v = sample(t);
    for (let c = 0; c < ch; c++)
      b.writeInt16LE(Math.max(-32000, Math.min(32000, Math.round((ch > 1 ? v[c] : v) * 15000))), 44 + (i * ch + c) * 2);
  }
  writeFileSync(dir + name, b);
}

wav("tone.wav", 3, 2, (t) => { const v = Math.sin(2 * Math.PI * 440 * t) * 0.8; return [v, v]; });
wav("mod-tone.wav", 30, 1, (t) => Math.sin(2 * Math.PI * (t < 15 ? 440 : 493.88) * t) * 0.8);
wav("stereo-song.wav", 12, 2, (t) => {
  const vocal = Math.sin(2 * Math.PI * 800 * t) * 0.5;
  return [vocal + Math.sin(2 * Math.PI * 300 * t) * 0.4, vocal + Math.sin(2 * Math.PI * 500 * t) * 0.4];
});
console.log("fixtures written to", dir);
