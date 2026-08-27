import type { Master } from "../types";
import type { Action } from "../state";

interface Props {
  master: Master;
  dispatch: React.Dispatch<Action>;
}

const BANDS = ["bass", "mid", "treble"] as const;

export default function MasterPanel({ master, dispatch }: Props) {
  return (
    <div className="master">
      <label className="enh">
        <input
          type="checkbox"
          checked={master.enhance}
          onChange={(e) => dispatch({ type: "SET_MASTER", patch: { enhance: e.target.checked } })}
        />
        ✨ Clarity enhance
        <span className="hint">— cuts rumble, lifts vocal presence, evens loudness</span>
      </label>
      <div className="eq">
        {BANDS.map((band) => (
          <label key={band}>
            {band[0].toUpperCase() + band.slice(1)}
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={master[band]}
              onChange={(e) => dispatch({ type: "SET_MASTER", patch: { [band]: Number(e.target.value) } })}
            />
            <span className="db">{master[band] > 0 ? "+" : ""}{master[band]} dB</span>
          </label>
        ))}
      </div>
    </div>
  );
}
