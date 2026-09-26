import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { BudgetsPage } from "./BudgetsPage";
import * as service from "../../services/budgets";
import { listCategories } from "../../services/catalog";
vi.mock("../../services/budgets", () => ({
  listBudgets: vi.fn(),
  saveBudget: vi.fn(),
  deleteBudget: vi.fn(),
  copyBudgets: vi.fn(),
}));
vi.mock("../../services/catalog", () => ({ listCategories: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue([
    {
      id: 1,
      name: "Moradia",
      kind: "expense",
      parentId: null,
      icon: "home",
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  vi.mocked(service.listBudgets).mockResolvedValue([]);
});
afterEach(cleanup);
const budget: service.Budget = {
  categoryId: 1,
  name: "Moradia",
  active: true,
  limitAmount: 10000,
  spent: "9000",
  remaining: "1000",
  percent: "90.0",
  state: "near",
};
it("creates exact limit, displays warning and confirms removal", async () => {
  render(<BudgetsPage />);
  await screen.findByText(/Nenhum limite definido/);
  fireEvent.click(screen.getByText("Definir limite"));
  await screen.findByRole("option", { name: "Moradia" });
  fireEvent.change(screen.getByLabelText("Categoria de despesa"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Limite (R$)"), {
    target: { value: "100,00" },
  });
  vi.mocked(service.saveBudget).mockResolvedValue([budget]);
  fireEvent.click(screen.getByText("Salvar limite"));
  await screen.findByText("Próximo do limite");
  expect(service.saveBudget).toHaveBeenCalledWith(expect.any(String), 1, 10000);
  expect(screen.getByText("90,0%")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Remover limite de Moradia"));
  expect(service.deleteBudget).not.toHaveBeenCalled();
  vi.mocked(service.deleteBudget).mockResolvedValue([]);
  fireEvent.click(screen.getByText("Confirmar remoção"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(service.deleteBudget).toHaveBeenCalledWith(expect.any(String), 1);
});
it("copies previous month and rejects negative amounts", async () => {
  render(<BudgetsPage />);
  await screen.findByText(/Nenhum limite definido/);
  vi.mocked(service.copyBudgets).mockResolvedValue([budget]);
  fireEvent.click(screen.getByText("Copiar mês anterior"));
  await screen.findByText("Próximo do limite");
  fireEvent.click(screen.getByLabelText("Editar limite de Moradia"));
  fireEvent.change(screen.getByLabelText("Limite (R$)"), {
    target: { value: "-1,00" },
  });
  fireEvent.click(screen.getByText("Salvar limite"));
  await screen.findByText("O limite não pode ser negativo.");
  expect(service.saveBudget).not.toHaveBeenCalled();
});
