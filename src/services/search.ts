import { invoke, isTauri } from "@tauri-apps/api/core";
export type SearchKind =
  "transaction" | "account" | "category" | "card" | "merchant";
export interface SearchRecord {
  kind: SearchKind;
  id: number;
  title: string;
  context: string;
  date: string | null;
  amount: string | null;
  state: string;
}
export interface SearchPage {
  items: SearchRecord[];
  page: number;
  hasMore: boolean;
}
export const searchLabels: Record<SearchKind, string> = {
  transaction: "Transação",
  account: "Conta",
  category: "Categoria",
  card: "Cartão",
  merchant: "Estabelecimento",
};
export function searchGlobal(query: string, page: number): Promise<SearchPage> {
  if (!isTauri())
    return Promise.reject(
      "A busca de registros está disponível no aplicativo desktop.",
    );
  return invoke("search_global", { query, page });
}
export function getSearchRecord(
  kind: SearchKind,
  id: number,
): Promise<SearchRecord> {
  return invoke("get_search_record", { kind, id });
}
