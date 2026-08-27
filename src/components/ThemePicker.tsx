import { useEffect, useState } from "react";

const THEMES = [
  { name: "violet", color: "hsl(262 70% 50%)" },
  { name: "ocean", color: "hsl(205 72% 48%)" },
  { name: "sunset", color: "hsl(24 78% 48%)" },
  { name: "forest", color: "hsl(150 50% 40%)" },
];
const MODES = ["auto", "light", "dark"] as const;

export default function ThemePicker() {
  const [theme, setTheme] = useState(() => localStorage.getItem("mm-theme") ?? "violet");
  const [mode, setMode] = useState(() => localStorage.getItem("mm-mode") ?? "auto");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mm-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (mode === "auto") delete document.documentElement.dataset.mode;
    else document.documentElement.dataset.mode = mode;
    localStorage.setItem("mm-mode", mode);
  }, [mode]);

  return (
    <div className="theme-picker">
      <div className="modes">
        {MODES.map((m) => (
          <button
            key={m}
            className={`mode-btn ${mode === m ? "active" : ""}`}
            onClick={() => setMode(m)}
            title={m === "auto" ? "Follow system" : `${m} mode`}
          >
            {m === "auto" ? "Auto" : m === "light" ? "☀" : "🌙"}
          </button>
        ))}
      </div>
      <div className="swatches">
        {THEMES.map((t) => (
          <button
            key={t.name}
            className={`swatch ${theme === t.name ? "active" : ""}`}
            style={{ background: t.color }}
            onClick={() => setTheme(t.name)}
            title={t.name}
          />
        ))}
      </div>
    </div>
  );
}
