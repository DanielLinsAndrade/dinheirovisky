import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { PurchaseForm } from "./PurchaseForm";
import { PurchasesPanel } from "./PurchasesPanel";
import * as api from "../../services/purchases";
import { listCategories } from "../../services/catalog";
vi.mock("../../services/catalog", () => ({ listCategories: vi.fn() }));
vi.mock("../../services/purchases", () => ({
  queryPurchases: vi.fn(),
  queryInvoices: vi.fn(),
  invoiceDetail: vi.fn(),
  savePurchase: vi.fn(),
  cancelPurchase: vi.fn(),
}));
vi.mock("../metadata/NameAutocomplete", () => ({
  NameAutocomplete: () => null,
}));
const card = {
  id: 1,
  name: "Principal",
  institution: "Banco",
  lastFour: null,
  brand: null,
  creditLimit: 10000,
  closingDay: 31,
  dueDay: 10,
  defaultAccountId: null,
  active: true,
  createdAt: "",
  updatedAt: "",
};
const purchase = {
  id: 1,
  cardId: 1,
  description: "Notebook",
  date: "2024-02-29",
  amount: 10000,
  installmentCount: 3,
  categoryId: null,
  merchant: null,
  intermediary: null,
  channel: null,
  notes: null,
  status: "active" as const,
  createdAt: "",
  updatedAt: "",
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue([]);
  vi.mocked(api.queryPurchases).mockResolvedValue({
    items: [purchase],
    total: 1,
    page: 0,
  });
  vi.mocked(api.queryInvoices).mockResolvedValue({
    items: [],
    total: 0,
    page: 0,
    committed: "10000",
    available: "0",
  });
});
it("preserva compra digitada após falha e envia centavos exatos", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValueOnce(undefined);
  render(
    <PurchaseForm
      cardId={1}
      purchase={purchase}
      categories={[]}
      busy={false}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("Total da compra (R$)"), {
    target: { value: "100,01" },
  });
  fireEvent.click(screen.getByText("Salvar compra"));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("Total da compra (R$)") as HTMLInputElement).value,
  ).toBe("100,01");
  fireEvent.click(screen.getByText("Salvar compra"));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: 10001, installmentCount: 3 }),
    ),
  );
});
it("cancelamento exige confirmação e erro permite retry", async () => {
  vi.mocked(api.cancelPurchase)
    .mockRejectedValueOnce("Falha ao cancelar")
    .mockResolvedValueOnce(undefined);
  render(<PurchasesPanel card={card} onBack={() => {}} />);
  fireEvent.click(await screen.findByText("Cancelar compra Notebook"));
  expect(api.cancelPurchase).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Confirmar cancelamento da compra"));
  await screen.findAllByText(/Falha ao cancelar/);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByText("Confirmar cancelamento da compra"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.cancelPurchase).toHaveBeenCalledTimes(2);
});
it("carregamento falho oferece recuperação e cartão arquivado impede nova compra", async () => {
  vi.mocked(api.queryPurchases).mockRejectedValueOnce("Sem acesso");
  render(
    <PurchasesPanel card={{ ...card, active: false }} onBack={() => {}} />,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Carregando compras e faturas…")).toBeNull();
  fireEvent.click(screen.getByText("Tentar compras novamente"));
  await screen.findByText("Notebook");
  expect(
    (screen.getByText("Nova compra no cartão") as HTMLButtonElement).disabled,
  ).toBe(true);
});
