import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AppStatus {
  appVersion: string;
  schemaVersion: number;
  sqliteVersion: string;
  databasePath: string;
}

export async function getAppStatus(): Promise<AppStatus> {
  if (!isTauri()) {
    throw new Error(
      "Abra a aplicação desktop com npm run tauri dev para acessar o banco local.",
    );
  }
  return invoke<AppStatus>("get_app_status");
}
