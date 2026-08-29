import type { Clip } from "../types";

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const round1 = (v: number) => Math.round(v * 10) / 10;

/** n:nn.n — all user-facing times show one decimal place. */
export function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds * 10) / 10);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Ruler tick labels are whole seconds — kept compact. */
export function fmtTick(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Accepts "83", "83.5", "1:23", "1:23.5", "1:02:03"; null for empty, NaN for garbage. */
export function parseTime(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN) || parts.length > 3) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Seconds a clip occupies on the output timeline (cut length ÷ speed). */
export const clipLength = (c: Clip) => (c.end - c.start) / c.speed;

export const mixLength = (clips: Clip[]) =>
  clips.length ? Math.max(...clips.map((c) => c.offset + clipLength(c))) : 0;
