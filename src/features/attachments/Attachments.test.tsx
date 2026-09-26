import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Attachments } from "./Attachments";
import * as files from "../../services/attachments";
vi.mock("../../services/attachments", () => ({
  listAttachments: vi.fn(),
  addAttachment: vi.fn(),
  readAttachment: vi.fn(),
  removeAttachment: vi.fn(),
}));
const item: files.Attachment = {
  id: 4,
  originalName: "recibo.png",
  internalName: "4-hash.png",
  mime: "image/png",
  size: 40,
  sha256: "hash",
  documentType: "proof",
  createdAt: "2026-09-22",
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const setup = () =>
  render(
    <Attachments kind="transaction" id={9} name="Mercado" onClose={() => {}} />,
  );
it("recupera erro de leitura e informa cancelamento sem alterar anexos", async () => {
  vi.mocked(files.listAttachments)
    .mockRejectedValueOnce("Leitura indisponível")
    .mockResolvedValue([]);
  vi.mocked(files.addAttachment).mockResolvedValue(null);
  setup();
  fireEvent.click(await screen.findByText("Tentar anexos novamente"));
  await screen.findByText(/Nenhum anexo/);
  fireEvent.click(screen.getByText("Adicionar anexo"));
  await screen.findByText("Seleção cancelada.");
  expect(files.listAttachments).toHaveBeenCalledTimes(2);
  expect(files.addAttachment).toHaveBeenCalledWith("transaction", 9, "proof");
});
it("abre conteúdo verificado, exige confirmação e preserva o anexo em falha", async () => {
  vi.mocked(files.listAttachments).mockResolvedValue([item]);
  vi.mocked(files.readAttachment).mockResolvedValue({
    attachment: item,
    bytes: [1, 2, 3],
  });
  vi.mocked(files.removeAttachment)
    .mockRejectedValueOnce("Não foi possível remover")
    .mockResolvedValue();
  const view = setup();
  fireEvent.click(await screen.findByText("Abrir recibo.png"));
  await screen.findByAltText("Anexo recibo.png");
  fireEvent.click(screen.getByText("Remover recibo.png"));
  expect(files.removeAttachment).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByText("Confirmar remoção de anexo", { selector: "button" }),
  );
  await screen.findByText("Não foi possível remover");
  expect(screen.getByAltText("Anexo recibo.png")).toBeTruthy();
  vi.mocked(files.listAttachments).mockResolvedValue([]);
  fireEvent.click(
    screen.getByText("Confirmar remoção de anexo", { selector: "button" }),
  );
  await screen.findByText("Anexo removido.");
  await waitFor(() =>
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test"),
  );
  expect(screen.queryByAltText("Anexo recibo.png")).toBeNull();
  view.unmount();
});
