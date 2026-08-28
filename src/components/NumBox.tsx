import { useEffect, useState } from "react";
import { clamp } from "../utils/time";

interface Props {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}

/**
 * Numeric box that commits on Enter or blur, not per keystroke — the user can
 * clear it and type freely (e.g. "0.5") without intermediate values being
 * applied or the tuning render kicking in mid-edit.
 */
export default function NumBox({ label, title, value, min, max, step, onCommit }: Props) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const v = Number(text);
    if (text.trim() === "" || Number.isNaN(v)) {
      setText(String(value)); // empty/garbage: revert, change nothing
      return;
    }
    const clamped = clamp(v, min, max);
    setText(String(clamped));
    onCommit(clamped);
  };

  return (
    <label title={title}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onFocus={(e) => {
          setEditing(true);
          // select-all so typing replaces the value (after the editing
          // re-render, which would otherwise collapse the selection)
          const el = e.target;
          setTimeout(() => el.select(), 0);
        }}
        onChange={(e) => { setEditing(true); setText(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}
