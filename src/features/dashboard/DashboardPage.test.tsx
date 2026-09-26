import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { listGoals } from "../../services/planning";
import { DashboardPage } from "./DashboardPage";
import { DashboardTrend } from "./DashboardTrend";
import { getDashboard, type Dashboard } from "../../services/dashboard";
import { barPercent, monthLabel } from "../../domain/dashboard";
vi.mock("../../services/dashboard", () => ({
  getDashboard: vi.fn(),
}));
vi.mock("../../services/commitments", () => ({
  queryCommitments: async () => ({
    items: [],
    total: 0,
    page: 0,
    committed: "0",
    estimated: "0",
    from: "2026-09-01",
    until: "2026-10-02",
  }),
  queryFinancialAlerts: async () => ({
    items: [],
    total: 0,
    page: 0,
    month: "2026-09",
    comparisonMonth: "2026-08",
  }),
}));
afterEach(cleanup);
it("ação rápida depende de conta ativa", async () => {
  vi.mocked(getDashboard).mockResolvedValue({ ...data, activeAccounts: 0 });
  const start = vi.fn();
  render(
    <DashboardPage
      onAccounts={() => {}}
      onTransactions={() => {}}
      onNewTransaction={start}
    />,
  );
  await screen.findByTestId("dashboard-balance");
  expect(
    (
      screen.getByRole("button", {
        name: "Nova transação",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  vi.mocked(getDashboard).mockResolvedValue(data);
  fireEvent.click(screen.getByText("Atualizar dashboard"));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Nova transação",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Nova transação"));
  expect(start).toHaveBeenCalledOnce();
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listGoals).mockResolvedValue([]);
});
const data: Dashboard = {
  balance: "12345",
  activeAccounts: 1,
  current: {
    month: "2026-09",
    income: "5000",
    expense: "1000",
    result: "4000",
  },
  previous: {
    month: "2026-08",
    income: "2000",
    expense: "3000",
    result: "-1000",
  },
  resultChange: "5000",
  trend: [
    { month: "2026-09", income: "5000", expense: "1000", result: "4000" },
  ],
  categories: [{ name: "Moradia", cents: "1000" }],
  recent: [],
};
it("representa estornos líquidos abaixo de zero no gráfico", () => {
  const { container } = render(
    <DashboardTrend
      data={{
        ...data,
        trend: [
          {
            month: "2026-09",
            income: "10000",
            expense: "-10000",
            result: "20000",
          },
        ],
      }}
    />,
  );
  const income = Number(
    container.querySelector(".trend-income circle")?.getAttribute("cy"),
  );
  const expense = Number(
    container.querySelector(".trend-expense circle")?.getAttribute("cy"),
  );
  expect(income).toBeCloseTo(34);
  expect(expense).toBeCloseTo(190);
  expect(
    container.querySelector(".trend-expense polygon")?.getAttribute("points"),
  ).toContain("70,112");
});
it("renders returned values, real zero states and working navigation", async () => {
  vi.mocked(getDashboard).mockResolvedValue(data);
  const onAccounts = vi.fn(),
    onTransactions = vi.fn();
  render(
    <DashboardPage onAccounts={onAccounts} onTransactions={onTransactions} />,
  );
  expect((await screen.findByTestId("dashboard-balance")).textContent).toBe(
    "R$ 123,45",
  );
  expect(screen.getByTestId("dashboard-result").textContent).toBe("R$ 40,00");
  expect(screen.getByText(/Variação: \+R\$ 50,00/)).toBeTruthy();
  expect(screen.getAllByText("Moradia")).toHaveLength(2);
  fireEvent.click(screen.getByText("Ver contas"));
  fireEvent.click(screen.getByText("Ver todas as transações"));
  expect(onAccounts).toHaveBeenCalledOnce();
  expect(onTransactions).toHaveBeenCalledOnce();
});
it("retries errors without showing invented totals", async () => {
  vi.mocked(getDashboard)
    .mockRejectedValueOnce(new Error("Banco bloqueado"))
    .mockResolvedValueOnce(data);
  render(<DashboardPage onAccounts={() => {}} onTransactions={() => {}} />);
  await screen.findByRole("alert");
  expect(screen.queryByTestId("dashboard-balance")).toBeNull();
  fireEvent.click(screen.getByText("Atualizar dashboard"));
  await screen.findByTestId("dashboard-balance");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("ignores stale results when changing month", async () => {
  let resolve!: (d: Dashboard) => void;
  vi.mocked(getDashboard)
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce({
      ...data,
      current: { ...data.current, month: "2025-01", income: "0" },
    });
  render(<DashboardPage onAccounts={() => {}} onTransactions={() => {}} />);
  fireEvent.change(screen.getByLabelText("Mês de referência"), {
    target: { value: "2025-01" },
  });
  await screen.findByText("Janeiro de 2025");
  resolve(data);
  await waitFor(() =>
    expect(screen.getByTestId("dashboard-income").textContent).toBe("R$ 0,00"),
  );
  expect(getDashboard).toHaveBeenLastCalledWith("2025-01");
});
it("draws bounded proportions without losing integer precision", () => {
  expect(barPercent("1", "0")).toBe(0);
  expect(barPercent("90071992547409910", "180143985094819820")).toBe(50);
  expect(barPercent("2", "1")).toBe(100);
  expect(monthLabel("2024-02")).toBe("Fevereiro de 2024");
  expect(monthLabel("2024-02", "en-US")).toBe("February 2024");
  expect(monthLabel("2024-02", "de-DE")).toBe("Februar 2024");
});
vi.mock("../../services/planning", () => ({
  materializeRecurrences: async () => 0,
  listRecurrences: async () => [],
  listGoals: vi.fn(),
}));

it("mostra tooltip exato por teclado e fecha com Escape", async () => {
  vi.mocked(getDashboard).mockResolvedValue(data);
  render(<DashboardPage onAccounts={() => {}} onTransactions={() => {}} />);
  const point = await screen.findByRole("button", {
    name: "Ver valores de 2026-09",
  });
  fireEvent.focus(point);
  const chart = screen.getByRole("region", { name: "Evolução do período" });
  expect(within(chart).getByRole("status").textContent).toContain(
    "Receitas R$ 50,00",
  );
  expect(within(chart).getByRole("status").textContent).toContain(
    "Despesas R$ 10,00",
  );
  fireEvent.keyDown(point, { key: "Escape" });
  expect(within(chart).queryByRole("status")).toBeNull();
});
it("metas reais permitem retentar falha e navegar", async () => {
  vi.mocked(getDashboard).mockResolvedValue(data);
  vi.mocked(listGoals)
    .mockRejectedValueOnce(new Error("Bloqueado"))
    .mockResolvedValueOnce([
      {
        id: 1,
        name: "Reserva",
        targetAmount: 10000,
        currentAmount: 2500,
        targetDate: null,
        completed: false,
        contributions: [],
      },
    ]);
  const open = vi.fn();
  render(
    <DashboardPage
      onAccounts={() => {}}
      onTransactions={() => {}}
      onGoals={open}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Tentar consultar metas" }),
  );
  const progress = await screen.findByRole("progressbar", {
    name: "Progresso de Reserva",
  });
  expect(progress.getAttribute("value")).toBe("25");
  expect(screen.getByText(/R\$ 25,00 \/ R\$ 100,00/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ver metas" }));
  expect(open).toHaveBeenCalledOnce();
});
it("distribuição inclui despesas fora das cinco primeiras categorias", async () => {
  vi.mocked(getDashboard).mockResolvedValue({
    ...data,
    current: { ...data.current, expense: "3000" },
  });
  render(<DashboardPage onAccounts={() => {}} onTransactions={() => {}} />);
  const distribution = await screen.findByRole("region", {
    name: "Distribuição de gastos",
  });
  expect(within(distribution).getByText("Outras categorias")).toBeTruthy();
  expect(within(distribution).getByText("R$ 20,00")).toBeTruthy();
});
