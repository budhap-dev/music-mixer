export interface Clip {
  id: number;
  fileId: string;
  name: string;
  dur: number; // source duration, seconds
  start: number; // cut start in the source
  end: number; // cut end in the source
  offset: number; // placement on the mix timeline
  gain: number; // 0–10, 1 = original
  speed: number; // 0.5–2, pitch preserved
  pitch: number; // semitones, −12…+12, tempo preserved
  muted: boolean;
  color: string;
}

export interface Master {
  bass: number; // dB, ±12
  mid: number;
  treble: number;
  enhance: boolean;
}

export interface ProjectState {
  clips: Clip[];
  master: Master;
  mixTitle: string;
}
