import { describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getAppStatus } from "./desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
describe("ponte nativa", () => {
  it("não simula conexão no navegador", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(getAppStatus()).rejects.toThrow("npm run tauri dev");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("consulta o comando nativo e propaga falhas", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValueOnce("Falha SQLite");
    await expect(getAppStatus()).rejects.toBe("Falha SQLite");
    expect(invoke).toHaveBeenCalledWith("get_app_status");
  });
});
