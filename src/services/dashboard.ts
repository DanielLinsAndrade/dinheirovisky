import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Movement } from "../domain/transactions";

export interface DuePayment {
  id: number;
  description: string;
  date: string;
  amount: number;
  accountName: string;
  status: "pending" | "scheduled";
}
export type DueHorizon = "all" | "overdue" | "week" | "month";
export interface DuePaymentPage {
  items: DuePayment[];
  total: number;
  page: number;
}
export async function queryDuePayments(
  today: string,
  horizon: DueHorizon,
  page: number,
): Promise<DuePaymentPage> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para consultar vencimentos.");
  return invoke("query_due_payments", { today, horizon, page });
}
export async function getDuePayments(today: string): Promise<DuePayment[]> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para consultar vencimentos.");
  return invoke<DuePayment[]>("get_due_payments", { today });
}

export interface MonthTotals {
  month: string;
  income: string;
  expense: string;
  result: string;
}
export interface Dashboard {
  balance: string;
  activeAccounts: number;
  current: MonthTotals;
  previous: MonthTotals | null;
  resultChange: string | null;
  trend: MonthTotals[];
  categories: { name: string; cents: string }[];
  recent: {
    movement: Movement;
    accountName: string;
    destinationName: string | null;
  }[];
}
export async function getDashboard(month: string): Promise<Dashboard> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para acessar o dashboard local.");
  return invoke<Dashboard>("get_dashboard", { month });
}
