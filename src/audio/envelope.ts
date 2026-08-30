/** Volume automation: points in clip-source time, linearly interpolated. */
export interface EnvPoint {
  t: number; // seconds in the source file
  g: number; // gain multiplier 0–2
}

export function envGainAt(env: EnvPoint[], t: number): number {
  if (!env.length) return 1;
  if (t <= env[0].t) return env[0].g;
  for (let i = 1; i < env.length; i++) {
    if (t < env[i].t) {
      const a = env[i - 1], b = env[i];
      return b.t > a.t ? a.g + ((t - a.t) / (b.t - a.t)) * (b.g - a.g) : b.g;
    }
  }
  return env[env.length - 1].g;
}
