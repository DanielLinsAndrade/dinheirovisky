import { invoke, isTauri } from "@tauri-apps/api/core";
export interface Budget {
  categoryId: number;
  name: string;
  active: boolean;
  limitAmount: number;
  spent: string;
  remaining: string;
  percent: string | null;
  state: "within" | "near" | "exceeded";
}
async function call(
  command: string,
  args: Record<string, unknown>,
): Promise<Budget[]> {
  if (!isTauri())
    throw new Error("Abra a aplicação desktop para acessar os orçamentos.");
  return invoke(command, args);
}
export const listBudgets = (month: string) => call("list_budgets", { month });
export const saveBudget = (
  month: string,
  categoryId: number,
  limitAmount: number,
) => call("save_budget", { month, categoryId, limitAmount });
export const deleteBudget = (month: string, categoryId: number) =>
  call("delete_budget", { month, categoryId });
export const copyBudgets = (month: string) => call("copy_budgets", { month });
