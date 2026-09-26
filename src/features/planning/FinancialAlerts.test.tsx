import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FinancialAlerts } from "./FinancialAlerts";
import {
  queryFinancialAlerts,
  type AlertPage,
} from "../../services/commitments";
vi.mock("../../services/commitments", () => ({
  queryFinancialAlerts: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const origin = {
  kind: "invoice" as const,
  id: 71,
  cardId: 9,
  month: null,
  comparisonMonth: null,
};
const data: AlertPage = {
  items: [
    {
      key: "invoice:71",
      severity: "warning",
      title: "Pagamento parcial",
      reason: "Há saldo restante após pagamentos.",
      date: "2026-09-25",
      amount: "901",
      reference: null,
      origin,
    },
  ],
  page: 0,
  total: 1,
  month: "2026-09",
  comparisonMonth: "2026-08",
};
it("recupera consulta e abre origem real sem efetivar pagamento", async () => {
  vi.mocked(queryFinancialAlerts)
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValue(data);
  const open = vi.fn();
  render(<FinancialAlerts onOrigin={open} />);
  await screen.findByText("Banco ocupado");
  expect(screen.queryByText("Nenhum alerta para estas regras.")).toBeNull();
  fireEvent.click(screen.getByText("Tentar alertas novamente"));
  await screen.findByText("Pagamento parcial");
  expect(screen.getByText(/9,01/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Abrir origem de Pagamento parcial" }),
  );
  expect(open).toHaveBeenCalledWith(origin);
});
it("comparação escolhida descarta resposta antiga e preserva filtros no backend", async () => {
  let first!: (r: AlertPage) => void;
  vi.mocked(queryFinancialAlerts)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        first = resolve;
      }),
    )
    .mockResolvedValue({
      ...data,
      items: [],
      total: 0,
      comparisonMonth: "2026-07",
    });
  render(<FinancialAlerts />);
  fireEvent.change(
    screen.getByLabelText("Mês financeiro de comparação (opcional)"),
    { target: { value: "2026-07" } },
  );
  await screen.findByText("Nenhum alerta para estas regras.");
  first(data);
  await waitFor(() =>
    expect(screen.queryByText("Pagamento parcial")).toBeNull(),
  );
  expect(queryFinancialAlerts).toHaveBeenLastCalledWith(
    expect.any(String),
    "2026-07",
    0,
  );
});
it("relê alertas após materialização ou atualização do dashboard", async () => {
  vi.mocked(queryFinancialAlerts)
    .mockResolvedValueOnce({ ...data, items: [], total: 0 })
    .mockResolvedValue(data);
  const view = render(<FinancialAlerts revision={0} />);
  await screen.findByText("Nenhum alerta para estas regras.");
  view.rerender(<FinancialAlerts revision={1} />);
  await screen.findByText("Pagamento parcial");
  expect(queryFinancialAlerts).toHaveBeenCalledTimes(2);
});
