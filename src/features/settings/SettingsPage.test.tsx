import { ThemeControl } from "../../app/ThemeControl";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { SettingsProvider } from "../../app/SettingsContext";
import { SettingsPage } from "./SettingsPage";
import { defaultSettings } from "../../domain/settings";
import { getSettings, saveSettings } from "../../services/settings";
vi.mock("../../services/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));
let dark = false;
let listener: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  dark = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_event: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: vi.fn(),
  }));
  vi.mocked(getSettings).mockResolvedValue(defaultSettings);
  vi.mocked(saveSettings).mockImplementation(async (s) => s);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("saves preferences with explicit currency acknowledgement and applies theme", async () => {
  render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>,
  );
  await screen.findByLabelText("Moeda");
  fireEvent.change(screen.getByLabelText("Moeda"), {
    target: { value: "USD" },
  });
  fireEvent.click(screen.getByText("Salvar configurações"));
  expect(saveSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Tema"), {
    target: { value: "dark" },
  });
  fireEvent.change(screen.getByLabelText("Formato regional"), {
    target: { value: "en-US" },
  });
  fireEvent.change(screen.getByLabelText("Início do mês financeiro"), {
    target: { value: "15" },
  });
  fireEvent.click(screen.getByText("Salvar configurações"));
  await screen.findByText("Configurações salvas.");
  expect(saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      currency: "USD",
      locale: "en-US",
      theme: "dark",
      financialMonthStart: 15,
    }),
    true,
  );
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
});
it("system theme responds to OS changes and failed save preserves old settings", async () => {
  render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>,
  );
  await screen.findByLabelText("Tema");
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("light"),
  );
  dark = true;
  listener();
  expect(document.documentElement.dataset.theme).toBe("dark");
  vi.mocked(saveSettings).mockRejectedValue("Banco ocupado");
  fireEvent.change(screen.getByLabelText("Tema"), {
    target: { value: "light" },
  });
  fireEvent.click(screen.getByText("Salvar configurações"));
  await screen.findByText("Banco ocupado");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect((screen.getByLabelText("Tema") as HTMLSelectElement).value).toBe(
    "light",
  );
});
it("retries startup failure before showing content", async () => {
  vi.mocked(getSettings)
    .mockRejectedValueOnce("Falha de leitura")
    .mockResolvedValueOnce(defaultSettings);
  render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>,
  );
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Moeda")).toBeNull();
  fireEvent.click(screen.getByText("Tentar carregar configurações"));
  await screen.findByLabelText("Moeda");
});

it("controle global persiste apenas o tema e preserva o anterior se falhar", async () => {
  render(
    <SettingsProvider>
      <ThemeControl />
    </SettingsProvider>,
  );
  const control = await screen.findByLabelText("Aparência");
  fireEvent.change(control, { target: { value: "dark" } });
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  expect(saveSettings).toHaveBeenLastCalledWith(
    { ...defaultSettings, theme: "dark" },
    false,
  );
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error("Banco ocupado"));
  fireEvent.change(control, { target: { value: "light" } });
  await screen.findByRole("alert");
  expect((control as HTMLSelectElement).value).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("troca global atualiza o formulário sem descartar preferências em edição", async () => {
  render(
    <SettingsProvider>
      <ThemeControl />
      <SettingsPage />
    </SettingsProvider>,
  );
  await screen.findByLabelText("Formato regional");
  fireEvent.change(screen.getByLabelText("Formato regional"), {
    target: { value: "de-DE" },
  });
  fireEvent.change(screen.getByLabelText("Aparência"), {
    target: { value: "dark" },
  });
  await waitFor(() =>
    expect((screen.getByLabelText("Tema") as HTMLSelectElement).value).toBe(
      "dark",
    ),
  );
  expect(
    (screen.getByLabelText("Formato regional") as HTMLSelectElement).value,
  ).toBe("de-DE");
  fireEvent.click(screen.getByText("Salvar configurações"));
  await screen.findByText("Configurações salvas.");
  expect(saveSettings).toHaveBeenLastCalledWith(
    { ...defaultSettings, theme: "dark", locale: "de-DE" },
    false,
  );
});
