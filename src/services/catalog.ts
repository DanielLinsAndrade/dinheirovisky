import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Account,
  AccountInput,
  Category,
  CategoryInput,
} from "../domain/catalog";

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri())
    return Promise.reject(
      new Error(
        "Abra a aplicação desktop com npm run tauri dev para acessar os cadastros locais.",
      ),
    );
  return invoke<T>(command, args);
}
export const listAccounts = () => call<Account[]>("list_accounts");
export const saveAccount = (input: AccountInput) =>
  call<Account[]>("save_account", { input });
export const setAccountActive = (id: number, active: boolean) =>
  call<Account[]>("set_account_active", { id, active });
export const listCategories = () => call<Category[]>("list_categories");
export const saveCategory = (input: CategoryInput) =>
  call<Category[]>("save_category", { input });
export const setCategoryActive = (id: number, active: boolean) =>
  call<Category[]>("set_category_active", { id, active });
