import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DuePayments } from "./DuePayments";
import {
  queryCommitments,
  type CommitmentPage,
} from "../../services/commitments";
vi.mock("../../services/commitments", () => ({ queryCommitments: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
const empty: CommitmentPage = {
  items: [],
  total: 0,
  page: 0,
  committed: "0",
  estimated: "0",
  from: "2026-09-01",
  until: "2026-10-02",
};
it("troca horizonte no backend e ignora resposta obsoleta", async () => {
  let resolve!: (page: CommitmentPage) => void;
  vi.mocked(queryCommitments)
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(empty);
  render(<DuePayments onTransactions={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Vencidos" }));
  await screen.findByText("Nenhum compromisso neste horizonte.");
  expect(queryCommitments).toHaveBeenLastCalledWith(
    expect.any(String),
    "overdue",
    0,
  );
  resolve({
    ...empty,
    items: [
      {
        id: 1,
        description: "Obsoleta",
        amount: "101",
        kind: "transaction",
        cardId: null,
        planningClass: null,
        installments: 0,
        partial: false,
        date: "2020-01-01",
        state: "pending",
        context: "Conta",
      },
    ],
    total: 1,
    page: 0,
  });
  await waitFor(() => expect(screen.queryByText("Obsoleta")).toBeNull());
  expect(
    screen
      .getByRole("button", { name: "Vencidos" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("erro não vira lista vazia e pode ser repetido sem ação financeira", async () => {
  vi.mocked(queryCommitments)
    .mockRejectedValueOnce("Banco ocupado")
    .mockResolvedValueOnce(empty);
  const navigate = vi.fn();
  render(<DuePayments onTransactions={navigate} />);
  await screen.findByRole("alert");
  expect(screen.queryByText("Nenhum compromisso neste horizonte.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByText("Nenhum compromisso neste horizonte.");
  fireEvent.click(
    screen.getByRole("button", { name: "Conferir transações programadas" }),
  );
  expect(navigate).toHaveBeenCalledOnce();
});
