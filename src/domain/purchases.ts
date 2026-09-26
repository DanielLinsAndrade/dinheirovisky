export interface PurchaseInput {
  id: number | null;
  cardId: number;
  description: string;
  date: string;
  amount: number;
  installmentCount: number;
  categoryId: number | null;
  merchant: string | null;
  intermediary: string | null;
  channel: string | null;
  notes: string | null;
}
export interface Purchase extends PurchaseInput {
  status: "active" | "cancelled";
  createdAt: string;
  updatedAt: string;
}
export interface PurchasePage {
  items: Purchase[];
  total: number;
  page: number;
}
export interface Invoice {
  id: number;
  month: string;
  closingDate: string;
  dueDate: string;
  charges: string;
  credits: string;
  net: string;
  paid: string;
  remaining: string;
  state: "open" | "closed" | "overdue" | "partial" | "paid";
  creditBalance: string;
}
export interface InvoicePage {
  items: Invoice[];
  total: number;
  page: number;
  committed: string;
  available: string;
}
export interface InvoiceDetail {
  events: InvoiceEvent[];
  invoice: Invoice;
  items: {
    purchaseId: number;
    description: string;
    number: number;
    count: number;
    amount: number;
    status: string;
  }[];
}

export interface InvoiceEventInput {
  requestKey: string;
  id: number | null;
  invoiceId: number;
  kind: "payment" | "refund" | "credit" | "charge";
  accountId: number | null;
  purchaseId: number | null;
  amount: number;
  date: string;
  description: string;
}
export interface InvoiceEvent extends InvoiceEventInput {
  voided: boolean;
  accountName: string | null;
  createdAt: string;
  updatedAt: string;
}
