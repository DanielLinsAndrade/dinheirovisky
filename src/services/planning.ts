import { invoke, isTauri } from "@tauri-apps/api/core";
import { localDate } from "../domain/transactions";
export interface RecurrenceInput {
  id: number | null;
  description: string;
  amount: number;
  kind: "income" | "expense";
  accountId: number;
  categoryId: number | null;
  notes: string | null;
  frequency: "weekly" | "monthly" | "yearly";
  interval: number;
  startDate: string;
  endDate: string | null;
  planningClass?: "fixed" | "seasonal" | null;
}
export interface Recurrence extends RecurrenceInput {
  active: boolean;
  ended: boolean;
  nextDate: string | null;
  blocked: boolean;
}
export interface GoalInput {
  id: number | null;
  name: string;
  targetAmount: number;
  targetDate: string | null;
}
export interface Goal extends GoalInput {
  id: number;
  currentAmount: number;
  completed: boolean;
  contributions: { id: number; amount: number; date: string }[];
}
async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauri())
    throw new Error(
      "Abra a aplicação desktop para acessar recorrências e metas.",
    );
  return invoke<T>(command, args);
}
export const listRecurrences = () => call<Recurrence[]>("list_recurrences");
export const saveRecurrence = (input: RecurrenceInput) =>
  call<Recurrence[]>("save_recurrence", { input });
export const setRecurrenceState = (
  id: number,
  action: "pause" | "resume" | "end",
) =>
  call<Recurrence[]>("set_recurrence_state", {
    id,
    action,
    today: localDate(),
  });
export const materializeRecurrences = () =>
  call<number>("materialize_recurrences", { today: localDate() });
export const listGoals = () => call<Goal[]>("list_goals");
export const saveGoal = (input: GoalInput) =>
  call<Goal[]>("save_goal", { input });
export const deleteGoal = (id: number) => call<Goal[]>("delete_goal", { id });
export const addContribution = (goalId: number, amount: number, date: string) =>
  call<Goal[]>("add_contribution", { goalId, amount, date });
export const removeContribution = (id: number) =>
  call<Goal[]>("remove_contribution", { id });
