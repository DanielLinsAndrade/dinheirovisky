import { useState } from "react";
import { useSettings } from "./SettingsContext";
import type { Settings } from "../domain/settings";
export function ThemeControl() {
  const { settings, save } = useSettings();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="theme-control">
      <label>
        <span className="sr-only">Aparência</span>
        <select
          aria-label="Aparência"
          value={settings.theme}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError("");
            try {
              await save(
                { ...settings, theme: e.target.value as Settings["theme"] },
                false,
              );
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="light">Claro</option>
          <option value="dark">Escuro</option>
          <option value="system">Sistema</option>
        </select>
      </label>
      {error && <p role="alert">Não foi possível mudar o tema. {error}</p>}
    </div>
  );
}
