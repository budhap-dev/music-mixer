/**
 * Musical key detection, segmented over time so in-song modulations show up:
 * Hann-windowed FFT frames -> chromagram per ~10s window -> Krumhansl-
 * Schmuckler profile correlation -> consecutive windows with the same key
 * merge into segments.
 */

export interface KeyRequest {
  id: number;
  sampleRate: number;
  samples: Float32Array; // mono
}

export interface KeySegment {
  start: number; // seconds into the source file
  tonic: number; // pitch class 0–11 (0 = C)
  mode: "major" | "minor";
}

export interface KeyResponse {
  id: number;
  segments: KeySegment[]; // empty if the file is essentially silent
}

// Sha'ath profiles (KeyFinder) — tuned on popular music: resistant to the
// dominant error, and the minor profile expects the natural-minor flat 7th
// (Temperley's classical minor punishes it and misreads pop minor keys)
const MAJOR = [6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4];
const MINOR = [6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2];

// 16384 at 44.1 kHz gives ~2.7 Hz bins — enough to separate semitones down
// to ~C2; with 8192 the bass octave smeared into neighbouring pitch classes
const N = 16384;
const WINDOW_S = 10; // key-estimation window in seconds

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const pearson = (a: number[], b: readonly number[]): number => {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
};

function estimate(chroma: number[]): { tonic: number; mode: "major" | "minor" } {
  let best = { tonic: 0, mode: "major" as "major" | "minor", r: -2 };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chroma[(i + tonic) % 12]);
    for (const [mode, profile] of [["major", MAJOR], ["minor", MINOR]] as const) {
      const r = pearson(rotated, profile);
      if (r > best.r) best = { tonic, mode, r };
    }
  }
  return { tonic: best.tonic, mode: best.mode };
}

self.onmessage = (e: MessageEvent<KeyRequest>) => {
  const { id, sampleRate, samples } = e.data;
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const windowLen = WINDOW_S * sampleRate;

  // Pass 1: per-window chroma at 0.1-semitone resolution (120 bins), so a
  // detuned or off-speed file (common with re-encoded rips) can be tuning-
  // compensated before pitch classes are assigned.
  const FINE = 120;
  const windows: { fine: Float64Array; energy: number }[] = [];
  const frameFine = new Float64Array(FINE);
  for (let w = 0; w * windowLen < samples.length; w++) {
    const from = Math.floor(w * windowLen);
    const to = Math.min(samples.length, from + windowLen);
    const fine = new Float64Array(FINE);
    let energy = 0;
    for (let off = from; off + N <= to; off += N) {
      for (let i = 0; i < N; i++) re[i] = samples[off + i] * hann[i];
      im.fill(0);
      fft(re, im);
      frameFine.fill(0);
      let frameSum = 0;
      // Fundamentals region only, power-weighted: upper harmonics otherwise
      // bleed a note's fifth into the chroma and drag the estimate to the
      // dominant (e.g. D-major songs reading as A major). Count only local
      // spectral peaks so broadband energy (drums, noise) doesn't pollute
      // the profile.
      const lo = Math.ceil((65 * N) / sampleRate);
      const hi = Math.floor((1000 * N) / sampleRate);
      for (let bin = lo; bin <= hi; bin++) {
        const power = re[bin] * re[bin] + im[bin] * im[bin];
        const before = re[bin - 1] * re[bin - 1] + im[bin - 1] * im[bin - 1];
        const after = re[bin + 1] * re[bin + 1] + im[bin + 1] * im[bin + 1];
        if (power < before || power < after) continue;
        const freq = (bin * sampleRate) / N;
        const semis = 12 * Math.log2(freq / 440);
        const fi = ((Math.round(semis * 10) % FINE) + FINE) % FINE;
        frameFine[fi] += power;
        frameSum += power;
      }
      energy += frameSum;
      // normalize per frame: keys are voted by how long notes sound, not how
      // loud — otherwise one loud figure (a trill, a hook) drowns the tonality
      if (frameSum > 1) for (let i = 0; i < FINE; i++) fine[i] += frameFine[i] / frameSum;
    }
    windows.push({ fine, energy });
  }

  // Global tuning offset: circular mean of each fine bin's deviation from the
  // nearest equal-tempered semitone, weighted by the whole track's chroma.
  let sumSin = 0, sumCos = 0;
  for (const { fine } of windows)
    for (let i = 0; i < FINE; i++) {
      const dev = ((i % 10) + 15) % 10 - 5; // -5..4 tenths of a semitone
      sumSin += fine[i] * Math.sin((2 * Math.PI * dev) / 10);
      sumCos += fine[i] * Math.cos((2 * Math.PI * dev) / 10);
    }
  const tuning = sumCos || sumSin ? (Math.atan2(sumSin, sumCos) / (2 * Math.PI)) : 0; // semitones

  // Pass 2: collapse to 12 pitch classes with tuning compensated; windows
  // quieter than 3% of the loudest carry the previous key instead of voting.
  const maxEnergy = Math.max(...windows.map((w) => w.energy), 0);
  const windowKeys: ({ tonic: number; mode: "major" | "minor" } | null)[] = windows.map(
    ({ fine, energy }) => {
      if (energy < maxEnergy * 0.03) return null;
      const chroma = new Array<number>(12).fill(0);
      for (let i = 0; i < FINE; i++) {
        if (!fine[i]) continue;
        const pc = ((Math.round(i / 10 - tuning) % 12) + 12 + 9) % 12; // A -> 9
        chroma[pc] += fine[i];
      }
      return estimate(chroma);
    },
  );

  // silent windows carry the previous key; one-window blips (analysis noise
  // flipping between related keys) revert to their neighbour's key
  for (let i = 0; i < windowKeys.length; i++) windowKeys[i] ??= windowKeys[i - 1] ?? null;
  const same = (a: (typeof windowKeys)[number], b: (typeof windowKeys)[number]) =>
    !!a && !!b && a.tonic === b.tonic && a.mode === b.mode;
  for (let i = 1; i < windowKeys.length - 1; i++)
    if (!same(windowKeys[i], windowKeys[i - 1]) && !same(windowKeys[i], windowKeys[i + 1]))
      windowKeys[i] = windowKeys[i - 1];

  const segments: KeySegment[] = [];
  for (let w = 0; w < windowKeys.length; w++) {
    const k = windowKeys[w];
    if (!k) continue;
    const prev = segments[segments.length - 1];
    if (!prev || prev.tonic !== k.tonic || prev.mode !== k.mode)
      segments.push({ start: (w * windowLen) / sampleRate, tonic: k.tonic, mode: k.mode });
  }
  if (segments.length) segments[0].start = 0;
  (self as unknown as Worker).postMessage({ id, segments } satisfies KeyResponse);
};
