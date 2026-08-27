# 🎚 Music Mixer

Cut, layer, speed/pitch-shift and EQ your audio — **entirely in the browser**. Files are opened, not uploaded: nothing ever leaves your machine. No server, no accounts.

**Status: milestone 2 of 6** — the timeline editor works, and the arrangement plays **live**: press ▶ and hear all clips together (overlaps blend), with per-clip volume/mute and master EQ applied in real time, a moving playhead, click-to-seek, and mid-play editing (the graph rebuilds under you). MP3 export is next — see [the story](https://github.com/budhap-dev/music-mixer/issues/1) for the full roadmap.

## Try it (dev)

```bash
npm install
npm run dev     # open the printed localhost URL
```

`npm run build` produces a fully static `dist/` — deployable to any static host (GitHub Pages / Cloudflare Pages; CI deploy lands in milestone 6).

## How it works

- **React + TypeScript + Vite** single-page app; state in a plain reducer (`src/state.ts`)
- **Web Audio API**: files decode to `AudioBuffer`s (kept outside React state in `src/audio/files.ts`)
- Live preview (`src/audio/engine.ts`): one `AudioBufferSourceNode` per clip scheduled on the timeline → per-clip `GainNode` → master EQ (`BiquadFilterNode` low-shelf/peaking/high-shelf) → optional clarity chain (highpass + presence + `DynamicsCompressorNode`). Volume/EQ update in place; structural edits rebuild the graph at the current position. Final render via `OfflineAudioContext` + in-page MP3 encoding (lamejs) — milestone 3.
- Known interim quirk: preview speed uses `playbackRate`, which also shifts pitch, and the Pitch control is not audible yet — both resolved by the milestone-4 worklet (the final render will be correct regardless).
- Speed is pitch-preserving and pitch is tempo-preserving (SoundTouch-style AudioWorklet — milestone 4)

## Roadmap (from [issue #1](https://github.com/budhap-dev/music-mixer/issues/1))

1. ✅ Scaffold + timeline editor
2. ✅ Live full-mix preview (Web Audio engine)
3. Render & MP3 export
4. Speed/pitch AudioWorklet
5. Projects (IndexedDB autosave, save/load, import/export)
6. Static deploy + CI, cross-browser pass

## Origin

Extracted from the mixer half of a private karaoke-making tool; rebuilt browser-only so it can be shared as a plain URL with zero hosting cost and the strongest possible privacy stance.
