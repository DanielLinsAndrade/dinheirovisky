import { invoke } from "@tauri-apps/api/core";
export type AnalysisView = "consumption" | "cash" | "installments";
export type AnalysisGrouping =
  | "method"
  | "card"
  | "invoice"
  | "merchant"
  | "channel"
  | "classification"
  | "recurrence"
  | "category";
export interface AnalysisFilter {
  from: string;
  to: string;
  view: AnalysisView;
  groupBy: AnalysisGrouping;
  accountId?: number | null;
  cardId?: number | null;
  invoiceId?: number | null;
  categoryId?: number | null;
  merchantId?: number | null;
  method?: string | null;
  channel?: string | null;
  recurrence?: string | null;
  planningClass?: string | null;
  comparisonFrom?: string | null;
  page: number;
}
export interface AnalysisTotals {
  income: string;
  expense: string;
  payments: string;
  transfers: string;
  installments: string;
  result: string;
  count: number;
}
export interface AnalysisReport {
  view: AnalysisView;
  startDate: string;
  untilDate: string;
  totals: AnalysisTotals;
  comparisonFrom: string | null;
  comparisonTo: string | null;
  comparison: AnalysisTotals | null;
  months: { month: string; totals: AnalysisTotals }[];
  groups: { key: string; name: string; totals: AnalysisTotals }[];
  groupCount: number;
  page: number;
}
export const getReportAnalysis = (filter: AnalysisFilter) =>
  invoke<AnalysisReport>("get_report_analysis", { filter });
