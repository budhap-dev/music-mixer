import { useEffect, useState } from "react";
import { fmt, parseTime } from "../utils/time";

interface Props {
  label: string;
  title: string;
  value: number;
  onCommit: (seconds: number) => void;
}

/** Editable m:ss.s box that live-tracks `value` unless the user is typing in it. */
export default function TimeBox({ label, title, value, onCommit }: Props) {
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!editing) {
      setText(fmt(value));
      setBad(false);
    }
  }, [value, editing]);

  const commit = () => {
    const v = parseTime(text);
    if (v === null || Number.isNaN(v)) {
      setBad(v !== null);
      if (v === null) setText(fmt(value));
      return;
    }
    setBad(false);
    onCommit(v);
  };

  return (
    <label title={title}>
      {label}
      <input
        className={`time ${bad ? "bad" : ""}`}
        type="text"
        value={text}
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onBlur={() => { setEditing(false); commit(); }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onChange={(e) => setText(e.target.value)}
      />
    </label>
  );
}
