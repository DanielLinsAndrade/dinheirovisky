import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ReportsPage } from "./ReportsPage";
import { getReport, type Report } from "../../services/reports";
import { listAccounts } from "../../services/catalog";
vi.mock("../../services/reports", () => ({ getReport: vi.fn() }));
vi.mock("../../services/catalog", () => ({ listAccounts: vi.fn() }));
afterEach(cleanup);
const data: Report = {
  startDate: "2026-01-01",
  endDate: "2026-02-28",
  accountName: null,
  openingBalance: "1000",
  closingBalance: "1100",
  income: "300",
  expense: "200",
  savings: "100",
  transfers: "0",
  movementCount: 2,
  months: [
    {
      month: "2026-01",
      income: "300",
      expense: "200",
      result: "100",
      transfers: "0",
      closingBalance: "1100",
      cumulativeSavings: "100",
      resultChange: "50",
    },
    {
      month: "2026-02",
      income: "0",
      expense: "0",
      result: "0",
      transfers: "0",
      closingBalance: "1100",
      cumulativeSavings: "100",
      resultChange: "-100",
    },
  ],
  categories: [{ id: null, name: "Sem categoria", expense: "200" }],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getReport).mockResolvedValue(data);
  vi.mocked(listAccounts).mockResolvedValue([
    {
      id: 1,
      name: "Antiga",
      kind: "checking",
      initialBalance: 0,
      active: false,
      createdAt: "",
      updatedAt: "",
    },
  ]);
});
it("shows real totals and switches balance/savings visualization", async () => {
  render(<ReportsPage />);
  await screen.findByTestId("report-income");
  expect(screen.getByTestId("report-income").textContent).toMatch(/3,00/);
  expect(screen.getByTestId("report-expense").textContent).toMatch(/2,00/);
  expect(screen.getByTestId("report-closing").textContent).toMatch(/11,00/);
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("Sem categoria")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Visualizar evolução"), {
    target: { value: "cumulativeSavings" },
  });
  expect(screen.getByRole("img").textContent).toContain(
    "Economia acumulada desde o início",
  );
});
it("applies periods and archived account, validates before invoking", async () => {
  render(<ReportsPage />);
  await screen.findByTestId("report-income");
  await screen.findByText("Antiga (arquivada)");
  fireEvent.change(screen.getByLabelText("Mês inicial"), {
    target: { value: "2026-02" },
  });
  fireEvent.change(screen.getByLabelText("Mês final"), {
    target: { value: "2026-01" },
  });
  fireEvent.click(screen.getByText("Aplicar filtros"));
  await screen.findByText(/intervalo ordenado/);
  expect(getReport).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Mês inicial"), {
    target: { value: "2026-01" },
  });
  fireEvent.change(screen.getByLabelText("Mês final"), {
    target: { value: "2026-03" },
  });
  fireEvent.change(screen.getByLabelText("Conta do relatório"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByText("Aplicar filtros"));
  await waitFor(() =>
    expect(getReport).toHaveBeenLastCalledWith({
      from: "2026-01",
      to: "2026-03",
      accountId: 1,
    }),
  );
});
it("retries failures without retaining stale totals and reports empty periods", async () => {
  vi.mocked(getReport)
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValueOnce({
      ...data,
      movementCount: 0,
      income: "0",
      expense: "0",
      savings: "0",
      categories: [],
    });
  render(<ReportsPage />);
  await screen.findByText(/Banco ocupado/);
  expect(screen.queryByTestId("report-income")).toBeNull();
  fireEvent.click(screen.getByText("Atualizar relatório"));
  await screen.findByText(/Nenhum lançamento efetivado neste período/);
  expect(
    screen.getByText("Nenhuma despesa efetivada no período."),
  ).toBeTruthy();
});
it("ignores older responses after changing the period", async () => {
  let resolveOld!: (value: Report) => void;
  vi.mocked(getReport)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...data, income: "98765" });
  render(<ReportsPage />);
  await waitFor(() => expect(getReport).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText("Últimos 12 meses"));
  await screen.findByTestId("report-income");
  expect(screen.getByTestId("report-income").textContent).toMatch(/987,65/);
  resolveOld(data);
  await waitFor(() =>
    expect(screen.getByTestId("report-income").textContent).toMatch(/987,65/),
  );
});
