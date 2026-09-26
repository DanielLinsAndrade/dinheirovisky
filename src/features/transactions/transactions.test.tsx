import { queryMetadata } from "../../services/metadata";
import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { TransactionsPage } from "./TransactionsPage";
import * as service from "../../services/transactions";
import { listAccounts, listCategories } from "../../services/catalog";
import type { Movement } from "../../domain/transactions";
vi.mock("../../services/transactions", () => ({
  queryTransactions: vi.fn(),
  saveTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));
vi.mock("../../services/metadata", async (original) => ({
  ...(await original<object>()),
  queryMetadata: vi.fn(),
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
it("Ctrl+N obedece ao botão sem conta ativa", async () => {
  vi.mocked(listAccounts).mockResolvedValue([]);
  render(<TransactionsPage />);
  await screen.findByText(
    "Cadastre ou reative uma conta para adicionar transações.",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Nova transação",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("Ctrl+N abre uma vez e Escape fecha sem gravar", async () => {
  render(<TransactionsPage />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Nova transação",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(service.saveTransaction).not.toHaveBeenCalled();
});
it("não mantém carregamento após falha inicial", async () => {
  vi.mocked(service.queryTransactions).mockRejectedValueOnce(
    new Error("Banco ocupado"),
  );
  render(<TransactionsPage />);
  await screen.findByText("Banco ocupado");
  await waitFor(() =>
    expect(screen.queryByText("Carregando transações…")).toBeNull(),
  );
});
const movement: Movement = {
  id: 1,
  description: "Mercado",
  amount: 1001,
  kind: "expense",
  date: "2026-09-11",
  accountId: 1,
  destinationAccountId: null,
  categoryId: null,
  status: "posted",
  notes: "Compra semanal",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(queryMetadata).mockResolvedValue([]);
  vi.mocked(listAccounts).mockResolvedValue([
    {
      id: 1,
      name: "Principal",
      kind: "checking",
      active: true,
      initialBalance: 0,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: 2,
      name: "Reserva",
      kind: "savings",
      active: true,
      initialBalance: 0,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  vi.mocked(listCategories).mockResolvedValue([]);
  vi.mocked(service.queryTransactions).mockResolvedValue({
    items: [movement],
    total: 1,
    page: 0,
  });
});
it("creates an exact-cent transfer and clears category", async () => {
  render(<TransactionsPage />);
  await waitFor(() =>
    expect(
      (screen.getByText("Nova transação") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Nova transação"));
  fireEvent.change(screen.getByLabelText("Descrição"), {
    target: { value: "Reserva mensal" },
  });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), {
    target: { value: "10,01" },
  });
  fireEvent.change(screen.getAllByLabelText("Tipo").at(-1)!, {
    target: { value: "transfer" },
  });
  fireEvent.change(screen.getByLabelText("Conta de destino"), {
    target: { value: "2" },
  });
  vi.mocked(service.saveTransaction).mockResolvedValue(undefined);
  fireEvent.click(screen.getByText("Salvar transação"));
  await waitFor(() =>
    expect(service.saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1001,
        kind: "transfer",
        accountId: 1,
        destinationAccountId: 2,
        categoryId: null,
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("filters history by destination, searches notes, and confirms deletion", async () => {
  vi.mocked(service.queryTransactions).mockImplementation(async (query) => {
    const items: Movement[] =
      query.search === "inexistente"
        ? []
        : [
            {
              ...movement,
              id: 2,
              description: "Reserva mensal",
              kind: "transfer",
              destinationAccountId: 2,
            },
          ];
    return { items, total: items.length, page: 0 };
  });
  render(<TransactionsPage accountId={2} />);
  await screen.findByText("Reserva mensal");
  expect(screen.queryByText("Mercado")).toBeNull();
  fireEvent.change(screen.getByLabelText("Pesquisar"), {
    target: { value: "inexistente" },
  });
  await waitFor(() => expect(screen.queryByText("Reserva mensal")).toBeNull());
  fireEvent.change(screen.getByLabelText("Pesquisar"), {
    target: { value: "semanal" },
  });
  await screen.findByText("Reserva mensal");
  expect(service.queryTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ accountId: 2, search: "semanal" }),
  );
  fireEvent.click(screen.getByLabelText("Excluir Reserva mensal"));
  expect(service.deleteTransaction).not.toHaveBeenCalled();
  vi.mocked(service.deleteTransaction).mockResolvedValue(undefined);
  fireEvent.click(screen.getByText("Confirmar exclusão"));
  await waitFor(() =>
    expect(service.deleteTransaction).toHaveBeenCalledWith(2),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("preserves edits on backend failure and rejects nonpositive values", async () => {
  render(<TransactionsPage />);
  await screen.findByText("Mercado");
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Editar Mercado") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByLabelText("Editar Mercado"));
  fireEvent.change(screen.getByLabelText("Valor (R$)"), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByText("Salvar transação"));
  await screen.findByText("Informe um valor maior que zero.");
  expect(service.saveTransaction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Valor (R$)"), {
    target: { value: "12,34" },
  });
  vi.mocked(service.saveTransaction).mockRejectedValue("Falha de gravação");
  fireEvent.click(screen.getByText("Salvar transação"));
  await screen.findByText("Falha de gravação");
  expect((screen.getByLabelText("Valor (R$)") as HTMLInputElement).value).toBe(
    "12,34",
  );
});

it("keeps a committed save closed when refreshing fails and retries only reading", async () => {
  render(<TransactionsPage />);
  await screen.findByText("Mercado");
  fireEvent.click(screen.getByLabelText("Editar Mercado"));
  vi.mocked(service.saveTransaction).mockResolvedValue(undefined);
  vi.mocked(service.queryTransactions).mockRejectedValueOnce(
    "Leitura indisponível",
  );
  fireEvent.click(screen.getByText("Salvar transação"));
  await screen.findByText("Leitura indisponível");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Atualizar transações"));
  await waitFor(() =>
    expect(screen.queryByText("Leitura indisponível")).toBeNull(),
  );
  expect(service.saveTransaction).toHaveBeenCalledTimes(1);
});

it("requests only the next backend page", async () => {
  vi.mocked(service.queryTransactions).mockImplementation(async (query) => ({
    items: [
      { ...movement, description: query.page ? "Segunda página" : "Mercado" },
    ],
    total: 51,
    page: query.page,
  }));
  render(<TransactionsPage />);
  await screen.findByText("Mercado");
  fireEvent.click(screen.getByText("Próxima"));
  await screen.findByText("Segunda página");
  expect(service.queryTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1 }),
  );
});

it("envia os filtros de metadados ao backend sem filtrar a página localmente", async () => {
  vi.mocked(queryMetadata).mockImplementation(async (kind) => [
    {
      id: kind === "method" ? 2 : kind === "merchant" ? 9 : 10,
      kind,
      name: kind,
      code: kind === "method" ? "pix" : null,
      active: true,
    },
  ]);
  render(<TransactionsPage />);
  await screen.findByText("Mercado");
  fireEvent.click(screen.getByText("Filtros de pagamento e compra"));
  await waitFor(() =>
    expect(
      screen
        .getByLabelText("Método de pagamento")
        .querySelector('option[value="2"]'),
    ).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText("Método de pagamento"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Estabelecimento"), {
    target: { value: "9" },
  });
  fireEvent.change(screen.getByLabelText("Intermediário"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Modalidade"), {
    target: { value: "online" },
  });
  await waitFor(() =>
    expect(service.queryTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        methodId: 2,
        merchantId: 9,
        intermediaryId: 10,
        channel: "online",
        page: 0,
      }),
    ),
  );
  expect(screen.getByText("Mercado")).not.toBeNull();
});
