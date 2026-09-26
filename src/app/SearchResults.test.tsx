import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { SearchRecordDetail } from "./SearchRecordDetail";
import {
  searchGlobal,
  getSearchRecord,
  type SearchRecord,
} from "../services/search";
vi.mock("../services/search", async (original) => ({
  ...(await original<typeof import("../services/search")>()),
  searchGlobal: vi.fn(),
  getSearchRecord: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const record: SearchRecord = {
  kind: "transaction",
  id: 77,
  title: "Mercado",
  context: "Conta principal · Alimentação",
  date: "2026-09-01",
  amount: "1234",
  state: "posted",
};
function setup() {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const onOpen = vi.fn();
  render(
    <CommandPalette onNavigate={() => {}} onClose={() => {}} onOpen={onOpen} />,
  );
  return onOpen;
}
it("busca no backend, pagina, abre o ID correto por teclado e preserva contexto", async () => {
  vi.mocked(searchGlobal)
    .mockResolvedValueOnce({ items: [record], page: 0, hasMore: true })
    .mockResolvedValueOnce({
      items: [{ ...record, id: 78, title: "Mercado 2" }],
      page: 1,
      hasMore: false,
    });
  const open = setup();
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "mercado" } });
  const result = await screen.findByRole("button", {
    name: /Transação: Mercado/,
  });
  expect(result.textContent).toContain("R$ 12,34");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(result);
  fireEvent.click(screen.getByText("Mais resultados"));
  const next = await screen.findByRole("button", { name: /Mercado 2/ });
  fireEvent.click(next);
  expect(open).toHaveBeenCalledWith({ ...record, id: 78, title: "Mercado 2" });
  expect(searchGlobal).toHaveBeenLastCalledWith("mercado", 1);
});
it("erro é recuperável e consulta antiga não substitui o termo atual", async () => {
  let old!: (r: {
    items: SearchRecord[];
    page: number;
    hasMore: boolean;
  }) => void;
  vi.mocked(searchGlobal)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    )
    .mockRejectedValueOnce("Falha SQLite")
    .mockResolvedValueOnce({ items: [], page: 0, hasMore: false });
  setup();
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "mercado" } });
  await waitFor(() => expect(searchGlobal).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "padaria" } });
  await screen.findByText("Falha SQLite");
  old({ items: [record], page: 0, hasMore: false });
  expect(
    screen.queryByRole("button", { name: /Transação: Mercado/ }),
  ).toBeNull();
  fireEvent.click(screen.getByText("Tentar busca novamente"));
  await screen.findByText("Nenhum registro encontrado.");
});
it("detalhe relê o registro, informa exclusão e permite tentar novamente", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(getSearchRecord)
    .mockRejectedValueOnce("Registro excluído")
    .mockResolvedValueOnce({ ...record, title: "Mercado atualizado" });
  render(<SearchRecordDetail target={record} onClose={() => {}} />);
  await screen.findByText("Registro excluído");
  fireEvent.click(screen.getByText("Tentar registro novamente"));
  await screen.findByText("Mercado atualizado");
  expect(getSearchRecord).toHaveBeenLastCalledWith("transaction", 77);
});
