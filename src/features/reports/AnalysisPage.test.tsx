import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { AnalysisPage } from "./AnalysisPage";
import { AnalysisResults } from "./AnalysisResults";
import { InvoiceFilter } from "./InvoiceFilter";
import {
  getReportAnalysis,
  type AnalysisReport,
} from "../../services/reportAnalysis";
import { queryInvoices } from "../../services/purchases";
vi.mock("../../services/reportAnalysis", () => ({
  getReportAnalysis: vi.fn(),
}));
vi.mock("../../services/catalog", () => ({
  listAccounts: async () => [],
  listCategories: async () => [],
}));
vi.mock("../../services/cards", () => ({ listCards: async () => [] }));
vi.mock("../../services/metadata", () => ({ queryMetadata: async () => [] }));
vi.mock("../../services/purchases", () => ({ queryInvoices: vi.fn() }));
const totals = {
  income: "0",
  expense: "90071992547409911",
  payments: "0",
  transfers: "0",
  installments: "0",
  result: "-90071992547409911",
  count: 1,
};
const data: AnalysisReport = {
  view: "consumption",
  startDate: "2026-03-01",
  untilDate: "2026-04-01",
  totals,
  comparisonFrom: "2026-02",
  comparisonTo: "2026-02",
  comparison: {
    ...totals,
    expense: "90071992547409910",
    result: "-90071992547409910",
  },
  months: [{ month: "2026-03", totals }],
  groups: [{ key: "online", name: "online", totals }],
  groupCount: 21,
  page: 0,
};
beforeEach(() => {
  vi.mocked(getReportAnalysis).mockResolvedValue(data);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("aplica filtros no backend sem tratar rascunho como resultado e recupera erro", async () => {
  vi.mocked(getReportAnalysis)
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValue(data);
  render(<AnalysisPage />);
  await screen.findByText("Banco ocupado");
  expect(screen.queryByText(/Nenhum registro corresponde/)).toBeNull();
  fireEvent.click(screen.getByText("Tentar análise novamente"));
  await screen.findByText(/1 registro/);
  const count = vi.mocked(getReportAnalysis).mock.calls.length;
  fireEvent.change(screen.getByLabelText("Modalidade do recorte"), {
    target: { value: "online" },
  });
  expect(getReportAnalysis).toHaveBeenCalledTimes(count);
  fireEvent.change(screen.getByLabelText("Mês inicial da análise"), {
    target: { value: "2026-03" },
  });
  fireEvent.change(screen.getByLabelText("Mês final da análise"), {
    target: { value: "2026-03" },
  });
  fireEvent.click(screen.getByText("Aplicar análise"));
  await waitFor(() =>
    expect(getReportAnalysis).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "2026-03",
        to: "2026-03",
        channel: "online",
        page: 0,
      }),
    ),
  );
  await screen.findByText(/1 registro/);
  fireEvent.click(screen.getByText("Mais grupos"));
  await waitFor(() =>
    expect(getReportAnalysis).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, channel: "online" }),
    ),
  );
});
it("apresenta comparação exata de um centavo e mantém sinais negativos", () => {
  render(<AnalysisResults data={data} grouping="channel" onPage={() => {}} />);
  const table = screen.getByRole("table", {
    name: "Valores exatos da comparação",
  });
  const row = within(table).getByRole("row", { name: /Consumo líquido/ });
  expect(within(row).getByText("R$ 0,01")).toBeTruthy();
  expect(
    within(table).getByRole("row", { name: /Resultado econômico/ }).textContent,
  ).toContain("-R$ 0,01");
  expect(screen.getByText("Online")).toBeTruthy();
  expect(screen.getByRole("img", { name: /Evolução mensal/ })).toBeTruthy();
});
it("filtro de faturas respeita as páginas de 24 do backend", async () => {
  vi.mocked(queryInvoices).mockResolvedValue({
    items: [],
    total: 24,
    page: 0,
    committed: "0",
    available: "0",
  });
  render(<InvoiceFilter cardId={7} value={null} onChange={() => {}} />);
  const more = await screen.findByRole("button", { name: "Mais faturas" });
  expect((more as HTMLButtonElement).disabled).toBe(true);
  expect(queryInvoices).toHaveBeenCalledWith(7, expect.any(String), 0);
});
