import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ImportPage } from "./ImportPage";
import * as imports from "../../services/imports";
import { listAccounts, listCategories } from "../../services/catalog";
vi.mock("../../services/imports", () => ({
  csvHeaders: vi.fn(),
  prepareImport: vi.fn(),
  reviewImport: vi.fn(),
  commitImport: vi.fn(),
  readImportFile: vi.fn(),
}));
vi.mock("../../services/catalog", () => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
it("permite repetir referências com falha e orienta quando não há contas", async () => {
  vi.mocked(listAccounts)
    .mockRejectedValueOnce(new Error("Banco ocupado"))
    .mockResolvedValue([]);
  render(<ImportPage />);
  await screen.findByText("Banco ocupado");
  expect(screen.queryByText("Carregando contas e categorias…")).toBeNull();
  fireEvent.click(screen.getByText("Tentar carregar contas e categorias"));
  await screen.findByText(
    "Crie ou reative uma conta na tela Contas antes de importar um extrato.",
  );
});
function row(
  line: number,
  overrides: Partial<imports.ReviewedRow> = {},
): imports.ReviewedRow {
  return {
    row: {
      line,
      sourceAccountId: 1,
      externalId: null,
      rawAmount: "-10,50",
      movement: {
        id: null,
        description: `Compra ${line}`,
        amount: 1050,
        kind: "expense",
        date: "2026-09-11",
        accountId: 1,
        destinationAccountId: null,
        categoryId: null,
        status: "posted",
        notes: null,
      },
    },
    error: null,
    duplicate: false,
    alreadyImported: false,
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listAccounts).mockResolvedValue([
    {
      id: 1,
      name: "Banco",
      kind: "checking",
      initialBalance: 0,
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  vi.mocked(listCategories).mockResolvedValue([]);
  vi.mocked(imports.readImportFile).mockResolvedValue("arquivo");
  vi.mocked(imports.csvHeaders).mockResolvedValue([
    "Data",
    "Descrição",
    "Valor",
  ]);
  vi.mocked(imports.prepareImport).mockResolvedValue({
    source: "CSV",
    currency: "BRL",
    rows: [
      row(2),
      row(3, { duplicate: true }),
      row(4, { error: "Data inválida" }),
      row(5, { alreadyImported: true }),
    ],
  });
  vi.mocked(imports.reviewImport).mockImplementation(async (rows) =>
    rows.map((r) => ({
      row: r,
      error: null,
      duplicate: r.line === 3,
      alreadyImported: false,
    })),
  );
  vi.mocked(imports.commitImport).mockResolvedValue({
    imported: 1,
    repeated: false,
  });
});
async function preview() {
  render(<ImportPage />);
  await screen.findByText("Banco");
  fireEvent.change(screen.getByLabelText("Arquivo"), {
    target: { files: [new File(["arquivo"], "extrato.csv")] },
  });
  fireEvent.click(screen.getByText("Ler colunas"));
  await screen.findByLabelText("Coluna de data");
  fireEvent.click(screen.getByText("Pré-visualizar"));
  await screen.findByRole("table");
}
it("previews without writing and excludes invalid, duplicate and imported rows by default", async () => {
  await preview();
  expect(imports.commitImport).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText("Importar registro 2") as HTMLInputElement).checked,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Importar registro 3") as HTMLInputElement).checked,
  ).toBe(false);
  expect(
    (screen.getByLabelText("Importar registro 4") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Importar registro 5") as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("Revisar confirmação"));
  await screen.findByRole("dialog");
  expect(imports.commitImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Fechar"));
  expect(imports.commitImport).not.toHaveBeenCalled();
});
it("requires acknowledgement for selected duplicates and preserves request identity on retry", async () => {
  vi.mocked(imports.commitImport).mockRejectedValueOnce(
    new Error("Resposta perdida"),
  );
  await preview();
  fireEvent.click(screen.getByLabelText("Importar registro 3"));
  fireEvent.click(screen.getByText("Revisar confirmação"));
  await screen.findByRole("dialog");
  expect(
    (screen.getByText("Confirmar e importar") as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText(/Revisei e quero incluir/));
  fireEvent.click(screen.getByText("Confirmar e importar"));
  await screen.findByText("Resposta perdida");
  const first = vi.mocked(imports.commitImport).mock.calls[0];
  expect(first[1]).toHaveLength(2);
  expect(first[3]).toBe(true);
  fireEvent.click(screen.getByText("Tentar confirmação novamente"));
  await screen.findByText(/lançamentos importados/);
  expect(vi.mocked(imports.commitImport).mock.calls[1]).toEqual(first);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("rechecks persisted state before confirmation and blocks changed references", async () => {
  await preview();
  vi.mocked(imports.reviewImport).mockResolvedValue([
    row(2, { error: "Conta arquivada" }),
  ]);
  fireEvent.click(screen.getByText("Revisar confirmação"));
  await screen.findByText(/Registro 2: Conta arquivada/);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(imports.commitImport).not.toHaveBeenCalled();
});
it("edits only the preview and revalidates rows before allowing selection", async () => {
  await preview();
  fireEvent.click(screen.getByText("Revisar registro 4"));
  await screen.findByRole("dialog");
  fireEvent.change(screen.getByLabelText("Descrição"), {
    target: { value: "Corrigida" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar transação" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Corrigida")).toBeTruthy();
  expect(
    (screen.getByLabelText("Importar registro 4") as HTMLInputElement).disabled,
  ).toBe(false);
  expect(imports.commitImport).not.toHaveBeenCalled();
});
it("paginates all records and renders descriptions as literal text", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => row(i + 2));
  rows[0].row.movement.description = "<script>alert(1)</script>";
  vi.mocked(imports.prepareImport).mockResolvedValue({
    source: "CSV",
    currency: "BRL",
    rows,
  });
  await preview();
  expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getAllByRole("row")).toHaveLength(51);
  fireEvent.click(screen.getByText("Próxima"));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Compra 52")).toBeTruthy();
});
