import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { InvoiceEvents } from "./InvoiceEvents";
import { saveInvoiceEvent, voidInvoiceEvent } from "../../services/purchases";
import { listAccounts } from "../../services/catalog";
import type { InvoiceDetail } from "../../domain/purchases";
vi.mock("../../services/purchases", () => ({
  saveInvoiceEvent: vi.fn(),
  voidInvoiceEvent: vi.fn(),
}));
vi.mock("../../services/catalog", () => ({ listAccounts: vi.fn() }));
const detail: InvoiceDetail = {
  invoice: {
    id: 1,
    month: "2024-02",
    closingDate: "2024-02-29",
    dueDate: "2024-03-10",
    charges: "10000",
    credits: "0",
    net: "10000",
    paid: "0",
    remaining: "10000",
    creditBalance: "0",
    state: "open",
  },
  items: [],
  events: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listAccounts).mockResolvedValue([
    {
      id: 1,
      name: "Conta",
      kind: "checking",
      initialBalance: 0,
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ]);
});
afterEach(cleanup);
it("reutiliza identificador após erro e preserva valor exato", async () => {
  const changed = vi.fn();
  vi.mocked(saveInvoiceEvent)
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValueOnce(1);
  render(
    <InvoiceEvents detail={detail} defaultAccount={1} onChange={changed} />,
  );
  await waitFor(() =>
    expect(
      (screen.getByText("Registrar pagamento ou ajuste") as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Registrar pagamento ou ajuste"));
  fireEvent.change(screen.getByLabelText("Valor do evento (R$)"), {
    target: { value: "33,34" },
  });
  fireEvent.click(screen.getByText("Salvar evento"));
  await screen.findByRole("alert");
  const first = vi.mocked(saveInvoiceEvent).mock.calls[0][0];
  expect(first.amount).toBe(3334);
  expect(first.accountId).toBe(1);
  fireEvent.click(screen.getByText("Salvar evento"));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(vi.mocked(saveInvoiceEvent).mock.calls[1][0].requestKey).toBe(
    first.requestKey,
  );
});
it("desfazer mantém evento até confirmação e preserva erro para retry", async () => {
  const e = {
    id: 5,
    requestKey: "payment-5",
    invoiceId: 1,
    kind: "payment" as const,
    accountId: 1,
    purchaseId: null,
    amount: 1000,
    date: "2024-03-01",
    description: "Pagamento",
    voided: false,
    accountName: "Conta",
    createdAt: "",
    updatedAt: "",
  };
  const changed = vi.fn();
  vi.mocked(voidInvoiceEvent)
    .mockRejectedValueOnce("Falhou")
    .mockResolvedValueOnce(undefined);
  render(
    <InvoiceEvents
      detail={{ ...detail, events: [e] }}
      defaultAccount={1}
      onChange={changed}
    />,
  );
  fireEvent.click(screen.getByText("Desfazer evento 5"));
  expect(voidInvoiceEvent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Confirmar desfazer evento"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Confirmar desfazer evento"));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(voidInvoiceEvent).toHaveBeenLastCalledWith(5);
});
