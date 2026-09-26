import { afterEach, beforeEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { GoalsPage } from "./GoalsPage";
import { StrictMode } from "react";
import { RecurrencesPage } from "./RecurrencesPage";
import { UpcomingRecurrences } from "./UpcomingRecurrences";
import * as api from "../../services/planning";
import { queryCommitments } from "../../services/commitments";
vi.mock("../../services/commitments", () => ({ queryCommitments: vi.fn() }));
const commitmentTotals = {
  committed: "606",
  estimated: "0",
  from: "2020-01-01",
  until: "2026-10-30",
};
import { listAccounts, listCategories } from "../../services/catalog";
vi.mock("../../services/planning", () => ({
  listGoals: vi.fn(),
  saveGoal: vi.fn(),
  addContribution: vi.fn(),
  removeContribution: vi.fn(),
  deleteGoal: vi.fn(),
  listRecurrences: vi.fn(),
  saveRecurrence: vi.fn(),
  setRecurrenceState: vi.fn(),
  materializeRecurrences: vi.fn(),
}));
vi.mock("../../services/catalog", () => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
}));
afterEach(cleanup);
it("mostra despesas reais e pagina sem repetir geração", async () => {
  const payments = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    description: `Despesa ${i + 1}`,
    date: "2020-01-01",
    amount: "101",
    context: "Principal",
    state: "pending",
    kind: "transaction" as const,
    cardId: null,
    planningClass: null,
    installments: 0,
    partial: false,
  }));
  vi.mocked(queryCommitments)
    .mockResolvedValueOnce({
      ...commitmentTotals,
      items: payments.slice(0, 5),
      total: 6,
      page: 0,
    })
    .mockResolvedValueOnce({
      ...commitmentTotals,
      items: payments.slice(5),
      total: 6,
      page: 1,
    });
  render(<UpcomingRecurrences onTransactions={() => {}} />);
  await screen.findByText(/^Despesa 1$/);
  expect(screen.queryByText(/^Despesa 6$/)).toBeNull();
  fireEvent.click(screen.getByText("Mais compromissos"));
  await screen.findByText(/^Despesa 6$/);
  expect(screen.queryByText(/^Despesa 1$/)).toBeNull();
  expect(api.materializeRecurrences).toHaveBeenCalledTimes(1);
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
const goal: api.Goal = {
  id: 1,
  name: "Reserva",
  targetAmount: 10000,
  currentAmount: 0,
  targetDate: null,
  completed: false,
  contributions: [],
};
const recurrence: api.Recurrence = {
  id: 1,
  description: "Internet",
  amount: 10000,
  kind: "expense",
  accountId: 1,
  categoryId: null,
  notes: null,
  frequency: "monthly",
  interval: 1,
  startDate: "2026-09-01",
  endDate: null,
  active: true,
  ended: false,
  nextDate: "2026-10-01",
  blocked: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(queryCommitments).mockResolvedValue({
    ...commitmentTotals,
    items: [],
    total: 0,
    page: 0,
  });
  vi.mocked(api.listGoals).mockResolvedValue([goal]);
  vi.mocked(api.listRecurrences).mockResolvedValue([recurrence]);
  vi.mocked(api.materializeRecurrences).mockResolvedValue(0);
  vi.mocked(listAccounts).mockResolvedValue([
    {
      id: 1,
      name: "Principal",
      kind: "checking",
      initialBalance: 0,
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  vi.mocked(listCategories).mockResolvedValue([]);
});
it("parses exact contributions, rejects negatives, and confirms removal", async () => {
  render(<GoalsPage />);
  await screen.findByText("Reserva");
  fireEvent.click(screen.getByText("Adicionar contribuição"));
  fireEvent.change(screen.getByLabelText("Contribuição (R$)"), {
    target: { value: "-1,00" },
  });
  fireEvent.click(screen.getByText("Salvar contribuição"));
  await screen.findByText("Informe um valor positivo.");
  expect(api.addContribution).not.toHaveBeenCalled();
  const complete = {
    ...goal,
    currentAmount: 10000,
    completed: true,
    contributions: [{ id: 4, amount: 10000, date: "2026-09-11" }],
  };
  vi.mocked(api.addContribution).mockResolvedValue([complete]);
  fireEvent.change(screen.getByLabelText("Contribuição (R$)"), {
    target: { value: "100,00" },
  });
  fireEvent.change(screen.getByLabelText("Data da contribuição"), {
    target: { value: "2026-09-11" },
  });
  fireEvent.click(screen.getByText("Salvar contribuição"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.addContribution).toHaveBeenCalledWith(1, 10000, "2026-09-11");
  expect(screen.getByText(/Concluída/)).toBeTruthy();
  fireEvent.click(screen.getByText("Contribuições (1)"));
  fireEvent.click(
    screen.getByRole("button", { name: /Remover contribuição de/ }),
  );
  expect(api.removeContribution).not.toHaveBeenCalled();
  vi.mocked(api.removeContribution).mockResolvedValue([goal]);
  fireEvent.click(screen.getByText("Confirmar remoção"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.removeContribution).toHaveBeenCalledWith(4);
  expect(screen.getByText(/Em andamento/)).toBeTruthy();
});
it("creates goals, retains form on failure, and confirms deletion", async () => {
  render(<GoalsPage />);
  await screen.findByText("Reserva");
  fireEvent.click(screen.getByText("Nova meta"));
  fireEvent.change(screen.getByLabelText("Nome da meta"), {
    target: { value: "Viagem" },
  });
  fireEvent.change(screen.getByLabelText("Valor alvo (R$)"), {
    target: { value: "1.234,56" },
  });
  vi.mocked(api.saveGoal)
    .mockRejectedValueOnce("Falha no banco")
    .mockResolvedValueOnce([goal]);
  fireEvent.click(screen.getByText("Salvar meta"));
  await screen.findByText("Falha no banco");
  expect(
    (screen.getByLabelText("Nome da meta") as HTMLInputElement).value,
  ).toBe("Viagem");
  fireEvent.click(screen.getByText("Salvar meta"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.saveGoal).toHaveBeenCalledWith({
    id: null,
    name: "Viagem",
    targetAmount: 123456,
    targetDate: null,
  });
  fireEvent.click(screen.getByText("Excluir meta"));
  expect(api.deleteGoal).not.toHaveBeenCalled();
  vi.mocked(api.deleteGoal).mockResolvedValue([]);
  fireEvent.click(screen.getByText("Confirmar remoção"));
  await screen.findByText(/Nenhuma meta cadastrada/);
});
it("creates a recurrence and preserves fixed calendar on editing", async () => {
  render(<RecurrencesPage onTransactions={() => {}} />);
  await screen.findByText("Internet");
  fireEvent.click(screen.getByText("Nova recorrência"));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Descrição") as HTMLInputElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Descrição"), {
    target: { value: "Aluguel" },
  });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), {
    target: { value: "1.234,56" },
  });
  fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Primeiro vencimento"), {
    target: { value: "2026-09-30" },
  });
  vi.mocked(api.saveRecurrence).mockResolvedValue([recurrence]);
  fireEvent.click(screen.getByText("Salvar recorrência"));
  await waitFor(() =>
    expect(api.saveRecurrence).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 123456,
        startDate: "2026-09-30",
        interval: 1,
        accountId: 1,
        kind: "expense",
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Editar Internet" }));
  expect(
    (screen.getByLabelText("Frequência") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Primeiro vencimento") as HTMLInputElement).disabled,
  ).toBe(true);
});
it("pauses, resumes and requires confirmation to end", async () => {
  render(<RecurrencesPage onTransactions={() => {}} />);
  await screen.findByText("Internet");
  vi.mocked(api.setRecurrenceState)
    .mockResolvedValueOnce([{ ...recurrence, active: false }])
    .mockResolvedValueOnce([recurrence])
    .mockResolvedValueOnce([
      { ...recurrence, ended: true, active: false, nextDate: null },
    ]);
  fireEvent.click(screen.getByText("Pausar"));
  await screen.findByText("Retomar");
  fireEvent.click(screen.getByText("Retomar"));
  await screen.findByText("Pausar");
  fireEvent.click(screen.getByText("Encerrar"));
  expect(api.setRecurrenceState).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText("Confirmar encerramento"));
  await screen.findByText("Encerrada");
  expect(api.setRecurrenceState).toHaveBeenLastCalledWith(1, "end");
});
it("dashboard retries materialization and previews real active series", async () => {
  vi.mocked(api.materializeRecurrences)
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValueOnce(3);
  const navigate = vi.fn();
  render(<UpcomingRecurrences onTransactions={navigate} />);
  await screen.findByText("Banco ocupado");
  fireEvent.click(screen.getByText("Atualizar vencimentos"));
  await screen.findByText(/3 lançamento/);
  fireEvent.click(screen.getByText("Estado das séries recorrentes"));
  expect(within(screen.getByRole("list")).getByText(/Internet/)).toBeTruthy();
  fireEvent.click(screen.getByText("Conferir transações programadas"));
  expect(navigate).toHaveBeenCalledOnce();
});
it("materializes one batch in StrictMode and refreshes the dashboard once", async () => {
  vi.mocked(api.materializeRecurrences).mockResolvedValue(2);
  const refresh = vi.fn();
  render(
    <StrictMode>
      <UpcomingRecurrences onTransactions={() => {}} onGenerated={refresh} />
    </StrictMode>,
  );
  await screen.findByText(/2 lançamento/);
  expect(api.materializeRecurrences).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Atualizar vencimentos"));
  await waitFor(() =>
    expect(api.materializeRecurrences).toHaveBeenCalledTimes(2),
  );
});
