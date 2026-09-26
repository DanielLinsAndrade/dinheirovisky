import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { TransactionForm } from "../transactions/TransactionForm";
import { MetadataManager } from "./MetadataManager";
import { NameAutocomplete } from "./NameAutocomplete";
import { queryMetadata, saveMetadata } from "../../services/metadata";
vi.mock("../../services/metadata", async (original) => ({
  ...(await original<object>()),
  queryMetadata: vi.fn(),
  saveMetadata: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(queryMetadata).mockImplementation(async (kind) =>
    kind === "method"
      ? [{ id: 2, kind: "method", name: "PIX", code: "pix", active: true }]
      : [],
  );
});
it("salva detalhes opcionais junto ao valor exato sem cadastrar antes de confirmar", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <TransactionForm
      movement={null}
      busy={false}
      categories={[]}
      accounts={[
        {
          id: 1,
          name: "Conta",
          kind: "checking",
          active: true,
          initialBalance: 0,
          createdAt: "",
          updatedAt: "",
        },
      ]}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("Descrição"), {
    target: { value: "Compra" },
  });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), {
    target: { value: "10,01" },
  });
  fireEvent.click(screen.getByText("Mais detalhes"));
  await waitFor(() =>
    expect(
      screen
        .getByLabelText("Método de pagamento")
        .querySelector('option[value="2"]'),
    ).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText("Método de pagamento"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Estabelecimento"), {
    target: { value: "Mercado" },
  });
  fireEvent.change(screen.getByLabelText("Modalidade"), {
    target: { value: "online" },
  });
  fireEvent.change(screen.getByLabelText("Intermediário / plataforma"), {
    target: { value: "Entrega" },
  });
  expect(saveMetadata).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Salvar transação"));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1001,
        details: expect.objectContaining({
          methodId: 2,
          merchant: "Mercado",
          channel: "online",
          intermediary: "Entrega",
        }),
      }),
    ),
  );
});
it("mantém o nome após erro de duplicata e bloqueia novas gravações enquanto aguarda", async () => {
  const busy = vi.fn();
  render(<MetadataManager onBusy={busy} />);
  await screen.findByText("PIX · Ativo");
  fireEvent.change(screen.getByLabelText("Nome do cadastro"), {
    target: { value: "PIX" },
  });
  vi.mocked(saveMetadata).mockRejectedValueOnce("Esse nome já existe");
  fireEvent.click(screen.getByText("Salvar cadastro"));
  await screen.findByText("Esse nome já existe");
  expect(
    (screen.getByLabelText("Nome do cadastro") as HTMLInputElement).value,
  ).toBe("PIX");
  let finish!: () => void;
  vi.mocked(saveMetadata).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByText("Editar PIX"));
  fireEvent.change(screen.getByLabelText("Nome do cadastro"), {
    target: { value: "PIX pessoal" },
  });
  fireEvent.click(screen.getByText("Salvar cadastro"));
  expect(busy).toHaveBeenLastCalledWith(true);
  expect(
    (
      screen
        .getByRole("button", { name: "Salvar cadastro" })
        .closest("fieldset") as HTMLFieldSetElement
    ).disabled,
  ).toBe(true);
  finish();
  await screen.findByText("Cadastro salvo.");
  expect(busy).toHaveBeenLastCalledWith(false);
  fireEvent.click(await screen.findByText("Arquivar PIX"));
  await waitFor(() =>
    expect(saveMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 2, active: false }),
    ),
  );
});
it("repete apenas consulta de sugestões e nunca cria cadastro após falha", async () => {
  vi.mocked(queryMetadata).mockRejectedValueOnce("Banco ocupado");
  render(
    <NameAutocomplete
      kind="merchant"
      label="Estabelecimento"
      value="Loja"
      onChange={() => {}}
    />,
  );
  await screen.findByText("Não foi possível consultar sugestões.");
  vi.mocked(queryMetadata).mockResolvedValueOnce([
    { id: 9, kind: "merchant", name: "Loja", code: null, active: true },
  ]);
  fireEvent.click(screen.getByText("Tentar sugestões de estabelecimento"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(queryMetadata).toHaveBeenLastCalledWith("merchant", "Loja", false);
  expect(saveMetadata).not.toHaveBeenCalled();
});
