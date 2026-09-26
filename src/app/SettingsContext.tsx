import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { defaultSettings, formatDate, type Settings } from "../domain/settings";
import { getSettings, saveSettings } from "../services/settings";
import * as money from "../domain/money";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
const Context = createContext<{
  settings: Settings;
  save: (input: Settings, confirm: boolean) => Promise<void>;
}>({
  settings: defaultSettings,
  save: async () => {
    throw new Error("Configurações indisponíveis.");
  },
});
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    getSettings().then(
      (s) => {
        if (active) setSettings(s);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    if (!settings) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.theme;
      document.documentElement.lang = "pt-BR";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings]);
  const theme = settings?.theme;
  useEffect(() => {
    if (!theme || !isTauri()) return;
    // Preserve native window controls while matching the application theme.
    void getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch((error: unknown) =>
        console.warn("Não foi possível sincronizar o tema da janela.", error),
      );
  }, [theme]);
  if (!settings)
    return (
      <main>
        <h1>Dinheirovisky</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="action" onClick={() => setAttempt((n) => n + 1)}>
              Tentar carregar configurações
            </button>
          </>
        ) : (
          <p role="status">Carregando configurações…</p>
        )}
      </main>
    );
  return (
    <Context.Provider
      value={{
        settings,
        save: async (input, confirm) => {
          const saved = await saveSettings(input, confirm);
          setSettings(saved);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSettings = () => useContext(Context);
export function useFormatting() {
  const { settings } = useSettings();
  return {
    formatMoney: (value: number | bigint) =>
      money.formatMoney(value, settings.locale, settings.currency),
    parseMoney: (value: string) => money.parseMoney(value, settings.locale),
    moneyInput: (value: number) => money.moneyInput(value, settings.locale),
    displayDate: (date: string) => formatDate(date, settings.dateFormat),
    currencyLabel: settings.currency === "BRL" ? "R$" : settings.currency,
    decimal: settings.locale === "en-US" ? "." : ",",
    settings,
  };
}
