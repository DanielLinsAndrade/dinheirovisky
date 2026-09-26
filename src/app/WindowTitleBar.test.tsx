import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WindowTitleBar } from "./WindowTitleBar";

const mock = vi.hoisted(() => ({
  desktop: true,
  maximized: false,
  resize: () => {},
  off: vi.fn(),
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mock.desktop }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    ...mock,
    isMaximized: async () => mock.maximized,
    onResized: async (callback: () => void) => {
      mock.resize = callback;
      return mock.off;
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.desktop = true;
  mock.maximized = false;
});
afterEach(cleanup);
it("usa controles oficiais separados da região arrastável e acompanha restauração", async () => {
  const { container, unmount } = render(<WindowTitleBar />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Minimizar janela" }));
  fireEvent.click(screen.getByRole("button", { name: "Maximizar janela" }));
  fireEvent.click(screen.getByRole("button", { name: "Fechar janela" }));
  expect(mock.minimize).toHaveBeenCalledOnce();
  expect(mock.toggleMaximize).toHaveBeenCalledOnce();
  expect(mock.close).toHaveBeenCalledOnce();
  expect(container.querySelector("[data-tauri-drag-region] button")).toBeNull();
  mock.maximized = true;
  act(() => mock.resize());
  await screen.findByRole("button", { name: "Restaurar janela" });
  unmount();
  expect(mock.off).toHaveBeenCalledOnce();
});
it("informa falha da API e permite tentar novamente", async () => {
  mock.minimize.mockRejectedValueOnce(new Error("denied"));
  render(<WindowTitleBar />);
  fireEvent.click(screen.getByRole("button", { name: "Minimizar janela" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Minimizar janela" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
it("não mostra controles inoperantes no navegador", () => {
  mock.desktop = false;
  const { container } = render(<WindowTitleBar />);
  expect(container.childElementCount).toBe(0);
});
