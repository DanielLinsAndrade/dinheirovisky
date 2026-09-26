import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Brand } from "../components/Brand";

// Mounted outside storage/settings gates so recovery screens retain controls.
export function WindowTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  const desktop = isTauri();
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    const sync = () => {
      void win
        .isMaximized()
        .then((value) => {
          if (active) setMaximized(value);
        })
        .catch(() => {});
    };
    sync();
    void win
      .onResized(sync)
      .then((off) => {
        if (active) unlisten = off;
        else off();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [desktop]);
  if (!desktop) return null;
  const run = (action: () => Promise<void>) => {
    setError("");
    void action().catch(() =>
      setError("Não foi possível controlar a janela. Tente novamente."),
    );
  };
  return (
    <header className="window-titlebar" aria-label="Janela Dinheirovisky">
      <div className="window-drag-region" data-tauri-drag-region>
        <Brand />
      </div>
      {error && (
        <span className="window-error" role="alert">
          {error}
        </span>
      )}
      <div className="window-controls">
        <button
          type="button"
          aria-label="Minimizar janela"
          title="Minimizar"
          onClick={() => run(() => getCurrentWindow().minimize())}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restaurar janela" : "Maximizar janela"}
          title={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => run(() => getCurrentWindow().toggleMaximize())}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d={maximized ? "M5 5V3h8v8h-2 M3 5h8v8H3z" : "M3 3h10v10H3z"}
            />
          </svg>
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Fechar janela"
          title="Fechar"
          onClick={() => run(() => getCurrentWindow().close())}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m3 3 10 10 M13 3 3 13" />
          </svg>
        </button>
      </div>
    </header>
  );
}
