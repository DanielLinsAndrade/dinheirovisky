import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Editor } from "./Editor";
afterEach(cleanup);
it("editor não modal permite ação externa, Escape e retorno de foco", async () => {
  const close = vi.fn(),
    outside = vi.fn();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const view = render(
    <>
      <button onClick={outside}>Navegar</button>
      <Editor
        modal={false}
        title="Editar"
        busy={false}
        error=""
        onClose={close}
      >
        <input aria-label="Nome" />
      </Editor>
    </>,
  );
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("false");
  expect(document.activeElement).toBe(screen.getByLabelText("Nome"));
  fireEvent.click(screen.getByText("Navegar"));
  expect(outside).toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  await waitFor(() => expect(document.activeElement).toBe(opener));
  opener.remove();
});
it("confirmação continua modal e impede fechar durante gravação", () => {
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.showModal = show;
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const close = vi.fn();
  render(
    <Editor title="Excluir" busy error="" onClose={close}>
      <p>Confirmar exclusão</p>
    </Editor>,
  );
  expect(show).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(close).not.toHaveBeenCalled();
});
