import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./App";
import { getAppStatus } from "../services/desktop";

vi.mock("../services/desktop", () => ({ getAppStatus: vi.fn() }));
vi.mock("../features/dashboard/DashboardPage", () => ({
  DashboardPage: () => <p>Resumo financeiro</p>,
}));
const status = {
  appVersion: "1.0.0",
  schemaVersion: 1,
  sqliteVersion: "3.53.0",
  databasePath: "C:/test/dinheirovisk.sqlite3",
};
afterEach(cleanup);

describe("fundação desktop", () => {
  it("confirma conexão e navega entre Início e Sobre", async () => {
    vi.mocked(getAppStatus).mockResolvedValue(status);
    render(<App />);
    await waitFor(() => expect(getAppStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Sobre" }));
    expect(screen.getByText(status.databasePath)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Sobre o Dinheirovisky",
    );
    fireEvent.click(screen.getByRole("button", { name: "Verificar conexão" }));
    await waitFor(() => expect(getAppStatus).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Início" }));
    expect(screen.getByText("Resumo financeiro")).toBeTruthy();
  });

  it("mostra erro real e permite tentar novamente", async () => {
    vi.mocked(getAppStatus)
      .mockRejectedValueOnce(new Error("Banco indisponível"))
      .mockResolvedValueOnce(status);
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Banco indisponível",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    fireEvent.click(screen.getByRole("button", { name: "Sobre" }));
    await screen.findByText("Armazenamento local conectado");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
