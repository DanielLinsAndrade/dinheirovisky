import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CardImportPage } from "./CardImportPage";
import * as service from "../../services/imports";
import { listCards } from "../../services/cards";
import { listCategories } from "../../services/catalog";
vi.mock("../../services/imports", () => ({
  readImportFile: vi.fn(),
  csvHeaders: vi.fn(),
  prepareCardImport: vi.fn(),
  reviewCardImport: vi.fn(),
  commitCardImport: vi.fn(),
}));
vi.mock("../../services/cards", () => ({ listCards: vi.fn() }));
vi.mock("../../services/catalog", () => ({ listCategories: vi.fn() }));
vi.mock("../cards/PurchaseForm", () => ({
  PurchaseForm: ({
    purchase,
    onSave,
  }: {
    purchase: service.CardImportRow["purchase"];
    onSave: (p: service.CardImportRow["purchase"]) => Promise<void>;
  }) => <button onClick={() => void onSave(purchase)}>Salvar compra</button>,
}));
const row: service.CardImportRow = {
  line: 2,
  purchase: {
    id: null,
    cardId: 1,
    description: "Compra CSV",
    date: "2026-09-21",
    amount: 1001,
    installmentCount: 3,
    categoryId: null,
    merchant: null,
    intermediary: null,
    channel: null,
    notes: null,
  },
  externalId: null,
  rawAmount: "-10,01",
  sourceCard: null,
  firstInvoice: null,
  confirmedPurchase: false,
  sourceKind: "expense",
};
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(listCards).mockResolvedValue([
    {
      id: 1,
      name: "Cartão teste",
      institution: "Banco",
      creditLimit: 10000,
      closingDay: 20,
      dueDay: 28,
      defaultAccountId: null,
      brand: null,
      lastFour: null,
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  vi.mocked(listCategories).mockResolvedValue([]);
  vi.mocked(service.readImportFile).mockResolvedValue("csv");
  vi.mocked(service.csvHeaders).mockResolvedValue([
    "Data",
    "Descrição",
    "Valor",
  ]);
  vi.mocked(service.prepareCardImport).mockResolvedValue({
    currency: "BRL",
    source: "CSV",
    rows: [
      {
        row,
        error: "Confirme a compra integral",
        duplicate: true,
        alreadyImported: false,
        calculatedInvoice: "2026-10",
      },
    ],
  });
  vi.mocked(service.reviewCardImport).mockImplementation(async (rows) =>
    rows.map((row) => ({
      row,
      error: row.confirmedPurchase ? null : "Confirme",
      duplicate: true,
      alreadyImported: false,
      calculatedInvoice: "2026-10",
    })),
  );
  vi.mocked(service.commitCardImport).mockResolvedValue({
    imported: 1,
    repeated: false,
  });
});
afterEach(cleanup);
it("bloqueia compra ambígua e exige revisão e reconhecimento de duplicatas, mantendo identidade no retry", async () => {
  render(<CardImportPage />);
  await screen.findByText("Cartão teste");
  fireEvent.change(screen.getByLabelText("Arquivo"), {
    target: { files: [new File(["csv"], "compras.csv")] },
  });
  fireEvent.click(screen.getByText("Ler colunas"));
  await screen.findByLabelText("Coluna de data");
  fireEvent.click(screen.getByText("Pré-visualizar compras"));
  await screen.findByRole("cell", { name: /Compra CSV/ });
  expect(
    (screen.getByLabelText("Importar compra 2") as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("Revisar compra 2"));
  fireEvent.click(screen.getByText("Salvar compra"));
  await screen.findByText("Confirme os dados da compra original.");
  expect(service.reviewCardImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/Conferi a origem:/));
  fireEvent.click(screen.getByText("Salvar compra"));
  await screen.findByText("Possível duplicata");
  expect(service.commitCardImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Importar compra 2"));
  fireEvent.click(screen.getByText("Revisar confirmação de compras"));
  await screen.findByRole("dialog");
  expect(
    (screen.getByText("Confirmar e importar compras") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText(/Revisei e quero incluir/));
  vi.mocked(service.commitCardImport).mockRejectedValueOnce(
    new Error("Resposta perdida"),
  );
  fireEvent.click(screen.getByText("Confirmar e importar compras"));
  await screen.findByText("Resposta perdida");
  const args = vi.mocked(service.commitCardImport).mock.calls[0];
  fireEvent.click(screen.getByText("Tentar confirmação novamente"));
  await screen.findByText(/1 compras importadas/);
  expect(vi.mocked(service.commitCardImport).mock.calls[1]).toEqual(args);
});
it("permite repetir carga de referências sem inventar cartões", async () => {
  vi.mocked(listCards).mockRejectedValueOnce(new Error("Banco ocupado"));
  render(<CardImportPage />);
  await screen.findByText("Banco ocupado");
  fireEvent.click(screen.getByText("Tentar carregar cartões"));
  await screen.findByText("Cartão teste");
  expect(service.prepareCardImport).not.toHaveBeenCalled();
});
