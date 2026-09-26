import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BackupPage } from "./BackupPage";
import * as backup from "../../services/backup";
vi.mock("../../services/backup", () => ({
  exportBackup: vi.fn(),
  exportTransactions: vi.fn(),
  prepareRestore: vi.fn(),
  cancelRestore: vi.fn(),
  confirmRestore: vi.fn(),
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
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backup.prepareRestore).mockResolvedValue({
    token: "validated",
    originalVersion: 6,
    attachments: 0,
    accounts: 2,
    transactions: 42,
    currency: "BRL",
  });
  vi.mocked(backup.cancelRestore).mockResolvedValue();
  vi.mocked(backup.confirmRestore).mockResolvedValue("C:/backup/antes.sqlite3");
});
it("requires explicit acknowledgement after validation and allows cancellation without restoring", async () => {
  render(<BackupPage />);
  fireEvent.click(screen.getByText("Selecionar backup para restaurar"));
  await screen.findByRole("dialog");
  expect(screen.getByText(/42 transações/)).toBeTruthy();
  expect(
    (screen.getByText("Restaurar e substituir dados") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(backup.confirmRestore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Fechar"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(backup.cancelRestore).toHaveBeenCalledOnce();
  expect(backup.confirmRestore).not.toHaveBeenCalled();
});
it("sends validated token only after consent and shows recovery location", async () => {
  render(<BackupPage />);
  fireEvent.click(screen.getByText("Selecionar backup para restaurar"));
  await screen.findByRole("dialog");
  fireEvent.click(
    screen.getByLabelText("Entendo que os dados atuais serão substituídos."),
  );
  fireEvent.click(screen.getByText("Restaurar e substituir dados"));
  await screen.findByText("Restauração concluída");
  expect(backup.confirmRestore).toHaveBeenCalledExactlyOnceWith(
    "validated",
    true,
  );
  expect(screen.getByText(/C:\/backup\/antes.sqlite3/)).toBeTruthy();
  expect(screen.getByText("Recarregar aplicação")).toBeTruthy();
});
it("reports validation and restore failures without a success message", async () => {
  vi.mocked(backup.prepareRestore).mockRejectedValueOnce(
    new Error("Arquivo inválido"),
  );
  render(<BackupPage />);
  fireEvent.click(screen.getByText("Selecionar backup para restaurar"));
  await screen.findByText("Arquivo inválido");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("Selecionar backup para restaurar"));
  await screen.findByRole("dialog");
  vi.mocked(backup.confirmRestore).mockRejectedValueOnce(
    new Error("Pasta sem acesso"),
  );
  fireEvent.click(
    screen.getByLabelText("Entendo que os dados atuais serão substituídos."),
  );
  fireEvent.click(screen.getByText("Restaurar e substituir dados"));
  await screen.findByText("Pasta sem acesso");
  expect(screen.queryByText("Restauração concluída")).toBeNull();
});
it("handles save cancellation and exported file feedback", async () => {
  vi.mocked(backup.exportBackup).mockResolvedValue(null);
  vi.mocked(backup.exportTransactions).mockResolvedValue(
    "42 transações exportadas para extrato.csv",
  );
  render(<BackupPage />);
  fireEvent.click(screen.getByText("Salvar backup"));
  await screen.findByText("Operação cancelada.");
  fireEvent.click(screen.getByText("Exportar CSV"));
  await screen.findByText(/42 transações exportadas/);
  expect(backup.confirmRestore).not.toHaveBeenCalled();
});
