import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "../domain/settings";
export async function getSettings(): Promise<Settings> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para carregar as configurações.");
  return invoke("get_settings");
}
export async function saveSettings(
  input: Settings,
  confirmCurrencyChange: boolean,
): Promise<Settings> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para salvar configurações.");
  return invoke("save_settings", { input, confirmCurrencyChange });
}
