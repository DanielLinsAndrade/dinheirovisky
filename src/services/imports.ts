import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Movement } from "../domain/transactions";
import type { PurchaseInput } from "../domain/purchases";

export interface CsvOptions {
  delimiter: string;
  decimal: string;
  dateFormat: string;
  dateColumn: number;
  descriptionColumn: number;
  amountColumn: number;
  typeColumn: number | null;
  metadataColumns?: Record<string, number>;
}
export interface ImportRow {
  line: number;
  sourceAccountId: number;
  movement: Movement;
  externalId: string | null;
  rawAmount: string;
}
export interface ReviewedRow {
  row: ImportRow;
  error: string | null;
  duplicate: boolean;
  alreadyImported: boolean;
}
export interface ImportPreview {
  currency: string;
  source: string;
  rows: ReviewedRow[];
}
export interface CardImportRow {
  line: number;
  purchase: PurchaseInput;
  externalId: string | null;
  rawAmount: string;
  sourceCard: string | null;
  firstInvoice: string | null;
  confirmedPurchase: boolean;
  sourceKind: string;
}
export interface ReviewedCardRow {
  row: CardImportRow;
  error: string | null;
  duplicate: boolean;
  alreadyImported: boolean;
  calculatedInvoice: string | null;
}
export interface CardImportPreview {
  currency: string;
  source: string;
  rows: ReviewedCardRow[];
}
export const prepareCardImport = (
  content: string,
  format: string,
  options: CsvOptions | null,
  cardId: number,
) =>
  call<CardImportPreview>("prepare_card_import", {
    content,
    format,
    options,
    cardId,
  });
export const reviewCardImport = (rows: CardImportRow[], currency: string) =>
  call<ReviewedCardRow[]>("review_card_import", { rows, currency });
export const commitCardImport = (
  requestId: string,
  rows: CardImportRow[],
  currency: string,
  allowDuplicates: boolean,
) =>
  call<{ imported: number; repeated: boolean }>("commit_card_import", {
    requestId,
    rows,
    currency,
    allowDuplicates,
  });
async function call<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para importar arquivos locais.");
  return invoke<T>(command, args);
}
export const csvHeaders = (content: string, delimiter: string) =>
  call<string[]>("import_csv_headers", { content, delimiter });
export const prepareImport = (
  content: string,
  format: string,
  options: CsvOptions | null,
  accountId: number,
) =>
  call<ImportPreview>("prepare_import", {
    content,
    format,
    options,
    accountId,
  });
export const reviewImport = (rows: ImportRow[], currency: string) =>
  call<ReviewedRow[]>("review_import", { rows, currency });
export const commitImport = (
  requestId: string,
  rows: ImportRow[],
  currency: string,
  allowDuplicates: boolean,
) =>
  call<{ imported: number; repeated: boolean }>("commit_import", {
    requestId,
    rows,
    currency,
    allowDuplicates,
  });

export async function readImportFile(
  file: File,
  encoding: string,
): Promise<string> {
  if (file.size > 2_000_000)
    throw new Error("Use arquivos de até 2 MB e 2000 lançamentos.");
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error(
      "Não foi possível ler o arquivo nesta codificação. Confira UTF-8 ou Windows-1252.",
    );
  }
}
