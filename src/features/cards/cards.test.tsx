import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { CardsPage } from "./CardsPage";
import * as service from "../../services/cards";
import { listAccounts } from "../../services/catalog";
import type { CreditCard } from "../../domain/cards";
vi.mock("../../services/cards", () => ({
  listCards: vi.fn(),
  saveCard: vi.fn(),
  setCardActive: vi.fn(),
  deleteCard: vi.fn(),
  cardCalendar: vi.fn(),
}));
vi.mock("../../services/catalog", () => ({ listAccounts: vi.fn() }));
const card: CreditCard = {
  id: 1,
  name: "Principal",
  institution: "Banco",
  lastFour: "0123",
  brand: null,
  creditLimit: 100001,
  closingDay: 31,
  dueDay: 10,
  defaultAccountId: null,
  active: true,
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
  vi.mocked(service.listCards).mockResolvedValue([card]);
  vi.mocked(listAccounts).mockResolvedValue([]);
});
it("edita limite exato e mantém entrada após falha", async () => {
  render(<CardsPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Editar Principal" }),
  );
  fireEvent.change(screen.getByLabelText("Limite (R$)"), {
    target: { value: "1234,56" },
  });
  vi.mocked(service.saveCard).mockRejectedValueOnce("Banco ocupado");
  fireEvent.click(screen.getByText("Salvar cartão"));
  await screen.findAllByText("Banco ocupado");
  expect((screen.getByLabelText("Limite (R$)") as HTMLInputElement).value).toBe(
    "1234,56",
  );
  vi.mocked(service.saveCard).mockResolvedValueOnce([
    { ...card, creditLimit: 123456 },
  ]);
  fireEvent.click(screen.getByText("Salvar cartão"));
  await waitFor(() =>
    expect(service.saveCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, creditLimit: 123456 }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("arquiva, consulta calendário real e pede confirmação para excluir", async () => {
  vi.mocked(service.setCardActive).mockResolvedValue([
    { ...card, active: false },
  ]);
  render(<CardsPage />);
  await screen.findByRole("button", { name: "Arquivar Principal" });
  fireEvent.change(screen.getByLabelText("Exibir cartões"), {
    target: { value: "all" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Arquivar Principal" }));
  await waitFor(() =>
    expect(service.setCardActive).toHaveBeenCalledWith(1, false),
  );
  // A consulta de calendário não materializa compras nem faturas.
  vi.mocked(service.cardCalendar).mockResolvedValue([
    { month: "2024-02", closingDate: "2024-02-29", dueDate: "2024-03-10" },
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: "Calendário de Principal" }),
  );
  await screen.findByText("29/02/2024");
  fireEvent.click(screen.getByText("Fechar"));
  fireEvent.click(screen.getByRole("button", { name: "Excluir Principal" }));
  expect(service.deleteCard).not.toHaveBeenCalled();
  vi.mocked(service.deleteCard).mockResolvedValue([]);
  fireEvent.click(screen.getByText("Confirmar exclusão do cartão"));
  await waitFor(() => expect(service.deleteCard).toHaveBeenCalledWith(1));
});
it("erro de leitura encerra carregamento e permite tentar novamente", async () => {
  vi.mocked(service.listCards).mockRejectedValueOnce("Leitura indisponível");
  render(<CardsPage />);
  await screen.findByText("Leitura indisponível");
  expect(screen.queryByText("Carregando cartões…")).toBeNull();
  fireEvent.click(screen.getByText("Atualizar cartões"));
  await screen.findByRole("button", { name: "Editar Principal" });
});
