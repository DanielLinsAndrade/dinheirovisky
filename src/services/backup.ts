import { invoke, isTauri } from "@tauri-apps/api/core";
export interface BackupPreview {
  token: string;
  originalVersion: number;
  accounts: number;
  transactions: number;
  attachments: number;
  currency: string;
}
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri())
    throw new Error(
      "Abra a aplicação desktop para acessar os arquivos locais.",
    );
  return invoke<T>(command, args);
}
export const exportBackup = () => call<string | null>("export_backup");
export const exportTransactions = () =>
  call<string | null>("export_transactions");
export const prepareRestore = () =>
  call<BackupPreview | null>("prepare_restore");
export const cancelRestore = () => call<void>("cancel_restore");
export const confirmRestore = (token: string, confirmed: boolean) =>
  call<string>("confirm_restore", { token, confirmed });
