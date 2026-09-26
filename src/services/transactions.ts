import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Movement } from "../domain/transactions";
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para acessar os dados locais.");
  return invoke<T>(command, args);
}
export const listTransactions = () => call<Movement[]>("list_transactions");
export interface TransactionQuery {
  search: string;
  accountId: number | null;
  categoryId: number | null;
  kind: string;
  status: string;
  from: string;
  to: string;
  sort: string;
  page: number;
  methodId?: number | null;
  merchantId?: number | null;
  intermediaryId?: number | null;
  channel?: string;
}
export interface TransactionPage {
  items: Movement[];
  total: number;
  page: number;
}
export const queryTransactions = (query: TransactionQuery) =>
  call<TransactionPage>("query_transactions", { query });
export const saveTransaction = (input: Movement) =>
  call<void>("save_transaction", { input });
export const deleteTransaction = (id: number) =>
  call<void>("delete_transaction", { id });
export const getBalances = () =>
  call<{ accountId: number; cents: string }[]>("get_balances");
