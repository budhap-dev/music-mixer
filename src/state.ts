import type { Clip, Master, ProjectState } from "./types";
import { clamp } from "./utils/time";

export const PALETTE = [
  "#6d28d9", "#0e7490", "#c2410c", "#15803d",
  "#be185d", "#4338ca", "#a16207", "#0f766e",
];

/** Black or white text, whichever reads better on the given hex colour. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111" : "#fff";
}

export const initialState: ProjectState = {
  clips: [],
  master: { bass: 0, mid: 0, treble: 0, enhance: false },
  mixTitle: "",
};

let nextId = 1;

export type Action =
  | { type: "ADD_CLIP"; fileId: string; name: string; duration: number }
  | { type: "UPDATE_CLIP"; id: number; patch: Partial<Clip> }
  | { type: "REMOVE_CLIP"; id: number }
  | { type: "MOVE_CLIP"; id: number; dir: -1 | 1 }
  | { type: "SET_MASTER"; patch: Partial<Master> }
  | { type: "SET_TITLE"; title: string };

export function reducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "ADD_CLIP": {
      const clip: Clip = {
        id: nextId++,
        fileId: action.fileId,
        name: action.name,
        dur: action.duration,
        start: 0,
        end: action.duration,
        offset: 0,
        gain: 1,
        speed: 1,
        pitch: 0,
        muted: false,
        color: PALETTE[state.clips.length % PALETTE.length],
      };
      return { ...state, clips: [...state.clips, clip] };
    }
    case "UPDATE_CLIP": {
      const patch = { ...action.patch };
      if (patch.speed !== undefined) patch.speed = clamp(patch.speed, 0.5, 2);
      if (patch.pitch !== undefined) patch.pitch = clamp(Math.round(patch.pitch), -12, 12);
      if (patch.gain !== undefined) patch.gain = clamp(patch.gain, 0, 10);
      return {
        ...state,
        clips: state.clips.map((c) => (c.id === action.id ? { ...c, ...patch } : c)),
      };
    }
    case "REMOVE_CLIP":
      return { ...state, clips: state.clips.filter((c) => c.id !== action.id) };
    case "MOVE_CLIP": {
      const i = state.clips.findIndex((c) => c.id === action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= state.clips.length) return state;
      const clips = [...state.clips];
      [clips[i], clips[j]] = [clips[j], clips[i]];
      return { ...state, clips };
    }
    case "SET_MASTER":
      return { ...state, master: { ...state.master, ...action.patch } };
    case "SET_TITLE":
      return { ...state, mixTitle: action.title };
  }
}

/* ---- undo/redo ---- */

export type HistoryAction = Action | { type: "UNDO" } | { type: "REDO" };

export interface History {
  past: ProjectState[];
  present: ProjectState;
  future: ProjectState[];
  lastKey: string | null; // coalescing: which knob the previous action turned
  lastTime: number;
}

export const initialHistory: History = {
  past: [],
  present: initialState,
  future: [],
  lastKey: null,
  lastTime: 0,
};

/**
 * Rapid same-target edits (a drag, typing, a slider sweep) merge into one undo
 * step; the key identifies the target so a different edit breaks the run.
 */
function coalesceKey(action: Action): string | null {
  switch (action.type) {
    case "UPDATE_CLIP":
      return `clip:${action.id}:${Object.keys(action.patch).sort().join()}`;
    case "SET_MASTER":
      return `master:${Object.keys(action.patch).sort().join()}`;
    case "SET_TITLE":
      return "title";
    default:
      return null;
  }
}

const MAX_UNDO = 100;
const COALESCE_MS = 1000;

export function historyReducer(h: History, action: HistoryAction): History {
  if (action.type === "UNDO") {
    if (!h.past.length) return h;
    return {
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future],
      lastKey: null,
      lastTime: 0,
    };
  }
  if (action.type === "REDO") {
    if (!h.future.length) return h;
    return {
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
      lastKey: null,
      lastTime: 0,
    };
  }
  const present = reducer(h.present, action);
  if (present === h.present) return h;
  const key = coalesceKey(action);
  const merge = key !== null && key === h.lastKey && Date.now() - h.lastTime < COALESCE_MS;
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-MAX_UNDO),
    present,
    future: [],
    lastKey: key,
    lastTime: Date.now(),
  };
}
