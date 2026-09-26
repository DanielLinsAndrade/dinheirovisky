import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  InvoiceEventInput,
  PurchaseInput,
  PurchasePage,
  InvoicePage,
  InvoiceDetail,
} from "../domain/purchases";
function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri())
    return Promise.reject(
      "Compras e faturas estão disponíveis no aplicativo desktop.",
    );
  return invoke<T>(command, args);
}
export function savePurchase(p: PurchaseInput) {
  const {
    id,
    cardId,
    description,
    date,
    amount,
    installmentCount,
    categoryId,
    merchant,
    intermediary,
    channel,
    notes,
  } = p;
  return call<number>("save_purchase", {
    input: {
      id,
      cardId,
      description,
      date,
      amount,
      installmentCount,
      categoryId,
      merchant,
      intermediary,
      channel,
      notes,
    },
  });
}
export const cancelPurchase = (id: number) =>
  call<void>("cancel_purchase", { id });
export const queryPurchases = (cardId: number, page: number) =>
  call<PurchasePage>("query_purchases", { cardId, page });
export const queryInvoices = (cardId: number, today: string, page: number) =>
  call<InvoicePage>("query_invoices", { cardId, today, page });
export const invoiceDetail = (id: number, today: string) =>
  call<InvoiceDetail>("invoice_detail", { id, today });
export function saveInvoiceEvent(p: InvoiceEventInput) {
  const {
    requestKey,
    id,
    invoiceId,
    kind,
    accountId,
    purchaseId,
    amount,
    date,
    description,
  } = p;
  return call<number>("save_invoice_event", {
    input: {
      requestKey,
      id,
      invoiceId,
      kind,
      accountId,
      purchaseId,
      amount,
      date,
      description,
    },
  });
}
export const voidInvoiceEvent = (id: number) =>
  call<void>("void_invoice_event", { id });
