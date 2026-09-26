import { invoke, isTauri } from "@tauri-apps/api/core";
export interface ReportFilter {
  from: string;
  to: string;
  accountId: number | null;
}
export interface ReportMonth {
  month: string;
  income: string;
  expense: string;
  result: string;
  transfers: string;
  closingBalance: string;
  cumulativeSavings: string;
  resultChange: string | null;
}
export interface Report {
  invoicePayments?: string;
  startDate: string;
  endDate: string;
  accountName: string | null;
  openingBalance: string;
  closingBalance: string;
  income: string;
  expense: string;
  savings: string;
  transfers: string;
  movementCount: number;
  months: ReportMonth[];
  categories: { id: number | null; name: string; expense: string }[];
}
export async function getReport(filter: ReportFilter): Promise<Report> {
  if (!isTauri())
    throw new Error(
      "Abra a aplicação desktop para consultar os relatórios locais.",
    );
  return invoke<Report>("get_report", { ...filter });
}
