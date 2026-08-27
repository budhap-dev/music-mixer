# 🎚 Music Mixer

Cut, layer, speed/pitch-shift and EQ your audio — **entirely in the browser**. Files are opened, not uploaded: nothing ever leaves your machine. No server, no accounts.

**Status: milestone 1 of 6** — the timeline editor works (open files → drag/trim clips, zoom, exact times, per-clip volume/speed/pitch, colours, rename, reorder, master EQ panel, themes). Playback and MP3 export are next — see [the story](https://github.com/budhap-dev/music-mixer/issues/1) for the full roadmap.

## Try it (dev)

```bash
npm install
npm run dev     # open the printed localhost URL
```

`npm run build` produces a fully static `dist/` — deployable to any static host (GitHub Pages / Cloudflare Pages; CI deploy lands in milestone 6).

## How it works

- **React + TypeScript + Vite** single-page app; state in a plain reducer (`src/state.ts`)
- **Web Audio API**: files decode to `AudioBuffer`s (kept outside React state in `src/audio/files.ts`)
- Live preview will use `AudioContext` graphs (gain + biquad EQ per the story); final render via `OfflineAudioContext` + in-page MP3 encoding (lamejs)
- Speed is pitch-preserving and pitch is tempo-preserving (SoundTouch-style AudioWorklet — milestone 4)

## Roadmap (from [issue #1](https://github.com/budhap-dev/music-mixer/issues/1))

1. ✅ Scaffold + timeline editor
2. Live full-mix preview (Web Audio engine)
3. Render & MP3 export
4. Speed/pitch AudioWorklet
5. Projects (IndexedDB autosave, save/load, import/export)
6. Static deploy + CI, cross-browser pass

## Origin

Extracted from the mixer half of a private karaoke-making tool; rebuilt browser-only so it can be shared as a plain URL with zero hosting cost and the strongest possible privacy stance.
