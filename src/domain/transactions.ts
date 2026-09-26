import type { MovementDetails } from "./metadata";
export const movementTypes = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
} as const;
export const movementStatuses = {
  posted: "Efetivado",
  pending: "Pendente",
  scheduled: "Programado",
} as const;
export interface Movement {
  id: number | null;
  description: string;
  amount: number;
  kind: keyof typeof movementTypes;
  date: string;
  accountId: number;
  destinationAccountId: number | null;
  categoryId: number | null;
  status: keyof typeof movementStatuses;
  notes: string | null;
  details?: MovementDetails;
}
export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function displayDate(date: string) {
  return date.split("-").reverse().join("/");
}
