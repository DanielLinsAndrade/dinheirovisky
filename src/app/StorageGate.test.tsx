import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { StorageGate } from "./StorageGate";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
});
it("encerra loading com erro e permite retry sem renderizar dados indisponíveis", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({
      ready: false,
      error: "Banco inválido",
      directory: "local",
    })
    .mockResolvedValueOnce({ ready: true });
  render(
    <StorageGate>
      <p>Aplicação pronta</p>
    </StorageGate>,
  );
  await screen.findByText("Banco inválido");
  expect(screen.queryByText("Verificando armazenamento…")).toBeNull();
  expect(screen.queryByText("Aplicação pronta")).toBeNull();
  fireEvent.click(screen.getByText("Tentar abrir novamente"));
  await screen.findByText("Aplicação pronta");
});
it("recuperação exige prévia e confirmação explícita; cancelamento não confirma", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "storage_status"
      ? { ready: false, error: "Banco inválido" }
      : command === "prepare_recovery"
        ? {
            token: "token",
            accounts: 2,
            transactions: 3,
            currency: "BRL",
            originalVersion: 6,
            attachments: 0,
          }
        : undefined,
  );
  render(
    <StorageGate>
      <p>Aplicação pronta</p>
    </StorageGate>,
  );
  await screen.findByText("Banco inválido");
  fireEvent.click(screen.getByText("Selecionar backup para recuperação"));
  await screen.findByText("Backup validado");
  expect(
    (screen.getByText("Confirmar recuperação") as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("Cancelar recuperação"));
  await waitFor(() => expect(screen.queryByText("Backup validado")).toBeNull());
  expect(
    vi.mocked(invoke).mock.calls.some(([c]) => c === "confirm_recovery"),
  ).toBe(false);
  fireEvent.click(screen.getByText("Selecionar backup para recuperação"));
  await screen.findByText("Backup validado");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Confirmar recuperação"));
  await screen.findByText("Aplicação pronta");
  expect(invoke).toHaveBeenCalledWith("confirm_recovery", {
    token: "token",
    confirmed: true,
  });
});
