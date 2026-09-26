import { invoke } from "@tauri-apps/api/core";
export type PlanningOrigin = {
  kind: "transaction" | "invoice" | "recurrence" | "budget" | "report";
  id: number | null;
  cardId?: number | null;
  month?: string | null;
  comparisonMonth?: string | null;
};
export type CommitmentHorizon =
  "all" | "overdue" | "week" | "month" | "next_month" | "next_invoice";
export interface Commitment {
  kind: "transaction" | "invoice" | "recurrence";
  id: number;
  cardId: number | null;
  description: string;
  date: string;
  amount: string;
  state: string;
  context: string;
  planningClass: "fixed" | "seasonal" | null;
  installments: number;
  partial: boolean;
}
export interface CommitmentPage {
  items: Commitment[];
  total: number;
  page: number;
  committed: string;
  estimated: string;
  from: string;
  until: string;
}
export interface FinancialAlert {
  key: string;
  severity: string;
  title: string;
  reason: string;
  date: string;
  amount: string;
  reference: string | null;
  origin: PlanningOrigin;
}
export interface AlertPage {
  items: FinancialAlert[];
  total: number;
  page: number;
  month: string;
  comparisonMonth: string | null;
}
export const queryCommitments = (
  today: string,
  horizon: CommitmentHorizon,
  page: number,
) => invoke<CommitmentPage>("query_commitments", { today, horizon, page });
export const queryFinancialAlerts = (
  today: string,
  comparisonMonth: string | null,
  page: number,
) =>
  invoke<AlertPage>("query_financial_alerts", { today, comparisonMonth, page });
