export type MetadataKind = "method" | "merchant" | "intermediary";
export interface Metadata {
  id: number;
  kind: MetadataKind;
  name: string;
  code: string | null;
  active: boolean;
}
export interface MovementDetails {
  methodId: number | null;
  methodName?: string | null;
  merchant: string | null;
  channel: "in_person" | "online" | null;
  intermediary: string | null;
}
export const emptyDetails: MovementDetails = {
  methodId: null,
  merchant: null,
  channel: null,
  intermediary: null,
};
export const methodCodes: Record<string, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  debit: "Débito",
  credit: "Crédito",
  boleto: "Boleto",
  transfer: "Transferência",
  automatic_debit: "Débito automático",
  other: "Outro",
};
