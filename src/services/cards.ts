import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CardInput, CreditCard, CardDates } from "../domain/cards";
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri())
    return Promise.reject(
      new Error("Abra o aplicativo desktop para acessar cartões."),
    );
  return invoke<T>(command, args);
}
export const listCards = () => call<CreditCard[]>("list_cards");
export const saveCard = ({
  id,
  name,
  institution,
  lastFour,
  brand,
  creditLimit,
  closingDay,
  dueDay,
  defaultAccountId,
}: CardInput) =>
  call<CreditCard[]>("save_card", {
    input: {
      id,
      name,
      institution,
      lastFour,
      brand,
      creditLimit,
      closingDay,
      dueDay,
      defaultAccountId,
    },
  });
export const setCardActive = (id: number, active: boolean) =>
  call<CreditCard[]>("set_card_active", { id, active });
export const deleteCard = (id: number) =>
  call<CreditCard[]>("delete_card", { id });
export const cardCalendar = (id: number, month: string) =>
  call<CardDates[]>("card_calendar", { id, month });
