import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppShell } from "./AppShell";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
function setup() {
  const navigate = vi.fn();
  render(
    <AppShell page="home" onNavigate={navigate}>
      <main id="content">Conteúdo atual</main>
    </AppShell>,
  );
  return navigate;
}
it("preserva todas as páginas reais em grupos e recolhe sem perder nomes acessíveis", () => {
  const navigate = setup();
  const nav = screen.getByRole("navigation", { name: "Navegação principal" });
  expect(within(nav).getAllByRole("button")).toHaveLength(13);
  fireEvent.click(within(nav).getByRole("button", { name: "Cartões" }));
  expect(navigate).toHaveBeenCalledWith("cards");
  expect(
    within(nav)
      .getByRole("button", { name: "Início" })
      .getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: "Recolher navegação" }));
  expect(
    screen
      .getByRole("button", { name: "Expandir navegação" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(
    within(nav).getByRole("button", { name: "Backup e restauração" }),
  );
  expect(navigate).toHaveBeenCalledWith("backup");
});
it("filtra páginas ignorando acentos e navega pelo teclado sem ações financeiras", () => {
  const navigate = setup();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const input = screen.getByRole("searchbox", { name: "Filtrar páginas" });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "orcamento" } });
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("button")).toHaveLength(2);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "Orçamento" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(navigate).toHaveBeenCalledExactlyOnceWith("budgets");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("informa ausência de resultado e restaura foco ao cancelar", async () => {
  setup();
  const opener = screen.getByRole("button", { name: /Ir para/ });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "cartão inexistente" },
  });
  expect(screen.getByRole("status").textContent).toBe(
    "Nenhuma página encontrada.",
  );
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});
it("não abre uma segunda paleta nem interrompe um editor existente", () => {
  setup();
  const existing = document.createElement("dialog");
  existing.open = true;
  document.body.append(existing);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.queryByRole("searchbox")).toBeNull();
  existing.remove();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
it("fecha a busca ao clicar no backdrop, mas não no padding ou ao arrastar de dentro", async () => {
  setup();
  const opener = screen.getByRole("button", { name: /Ir para/ });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog");
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 600,
    top: 100,
    bottom: 600,
  } as DOMRect);
  fireEvent(
    dialog,
    new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 110,
      clientY: 110,
    }),
  );
  fireEvent.click(dialog, { clientX: 110, clientY: 110 });
  expect(screen.getByRole("dialog")).toBe(dialog);
  fireEvent.pointerDown(screen.getByRole("searchbox"));
  fireEvent.click(dialog, { clientX: 20, clientY: 120 });
  expect(screen.getByRole("dialog")).toBe(dialog);
  fireEvent(
    dialog,
    new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 120 }),
  );
  fireEvent.click(dialog, { clientX: 20, clientY: 120 });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
