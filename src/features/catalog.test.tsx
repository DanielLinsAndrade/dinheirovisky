import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AccountsPage } from "./accounts/AccountsPage";
import { CategoriesPage } from "./categories/CategoriesPage";
import * as service from "../services/catalog";
import type { Account, Category } from "../domain/catalog";
import { getBalances } from "../services/transactions";
vi.mock("../services/transactions", () => ({ getBalances: vi.fn() }));

vi.mock("../services/catalog", () => ({
  listAccounts: vi.fn(),
  saveAccount: vi.fn(),
  setAccountActive: vi.fn(),
  listCategories: vi.fn(),
  saveCategory: vi.fn(),
  setCategoryActive: vi.fn(),
}));
// jsdom não implementa a modalidade/foco nativos do dialog; testamos o fluxo React.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getBalances).mockResolvedValue([]);
});
afterEach(cleanup);
const account: Account = {
  id: 1,
  name: "Principal",
  kind: "checking",
  initialBalance: 123456,
  active: true,
  createdAt: "",
  updatedAt: "",
};
const category: Category = {
  id: 1,
  name: "Moradia",
  kind: "expense",
  parentId: null,
  icon: "home",
  active: true,
  createdAt: "",
  updatedAt: "",
};

describe("contas", () => {
  it("cria com centavos exatos, edita e arquiva/reativa sem excluir", async () => {
    vi.mocked(service.listAccounts).mockResolvedValue([]);
    vi.mocked(service.saveAccount).mockResolvedValueOnce([account]);
    render(<AccountsPage />);
    await screen.findByText(
      "Nenhuma conta cadastrada. Use Nova conta para começar.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Nova conta" }));
    fireEvent.change(screen.getByLabelText("Nome da conta"), {
      target: { value: "Principal" },
    });
    fireEvent.change(screen.getByLabelText("Saldo inicial (R$)"), {
      target: { value: "1.234,56" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    await screen.findByText("Conta salva.");
    expect(service.saveAccount).toHaveBeenCalledWith({
      id: null,
      name: "Principal",
      kind: "checking",
      initialBalance: 123456,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar Principal" }));
    expect(
      (screen.getByLabelText("Saldo inicial (R$)") as HTMLInputElement).value,
    ).toBe("1234,56");
    const edited = {
      ...account,
      name: "Carteira",
      kind: "wallet" as const,
      initialBalance: -5010,
    };
    vi.mocked(service.saveAccount).mockResolvedValueOnce([edited]);
    fireEvent.change(screen.getByLabelText("Nome da conta"), {
      target: { value: "Carteira" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de conta"), {
      target: { value: "wallet" },
    });
    fireEvent.change(screen.getByLabelText("Saldo inicial (R$)"), {
      target: { value: "-50,10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.saveAccount).toHaveBeenLastCalledWith({
      id: 1,
      name: "Carteira",
      kind: "wallet",
      initialBalance: -5010,
    });
    vi.mocked(service.setAccountActive).mockResolvedValueOnce([
      { ...edited, active: false },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arquivar Carteira" }));
    await screen.findByText("Nenhuma conta neste filtro.");
    expect(service.setAccountActive).toHaveBeenCalledWith(1, false);
    expect(await screen.findByText("R$ 0,00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Exibir"), {
      target: { value: "archived" },
    });
    vi.mocked(service.setAccountActive).mockResolvedValueOnce([edited]);
    fireEvent.click(screen.getByRole("button", { name: "Reativar Carteira" }));
    await screen.findByText("Conta reativada.");
    expect(service.setAccountActive).toHaveBeenLastCalledWith(1, true);
  });

  it("mantém os campos após erro e permite corrigir sem duplicar envios", async () => {
    vi.mocked(service.listAccounts).mockResolvedValue([]);
    vi.mocked(service.saveAccount).mockRejectedValueOnce("Nome já utilizado.");
    render(<AccountsPage />);
    await screen.findByText(
      "Nenhuma conta cadastrada. Use Nova conta para começar.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Nova conta" }));
    fireEvent.change(screen.getByLabelText("Nome da conta"), {
      target: { value: "Principal" },
    });
    fireEvent.change(screen.getByLabelText("Saldo inicial (R$)"), {
      target: { value: "1,234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    expect(service.saveAccount).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Saldo inicial (R$)"), {
      target: { value: "10,50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    await screen.findByText("Nome já utilizado.");
    expect(
      (screen.getByLabelText("Nome da conta") as HTMLInputElement).value,
    ).toBe("Principal");
    let finish!: (rows: Account[]) => void;
    vi.mocked(service.saveAccount).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    expect(
      (
        screen.getByRole("button", { name: "Salvando…" }) as HTMLButtonElement
      ).closest("fieldset")?.disabled,
    ).toBe(true);
    finish([account]);
    await screen.findByText("Conta salva.");
    expect(service.saveAccount).toHaveBeenCalledTimes(2);
  });

  it("mostra erro de carregamento e tenta novamente", async () => {
    vi.mocked(service.listAccounts)
      .mockRejectedValueOnce(new Error("Banco indisponível"))
      .mockResolvedValueOnce([account]);
    render(<AccountsPage />);
    await screen.findByText("Banco indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar contas" }));
    await screen.findByRole("button", { name: "Editar Principal" });
  });
});

describe("categorias", () => {
  it("cria subcategoria com vínculo, edita e permite arquivar/reativar", async () => {
    vi.mocked(service.listCategories).mockResolvedValue([category]);
    const child: Category = {
      ...category,
      id: 2,
      name: "Internet",
      parentId: 1,
      icon: "tag",
    };
    vi.mocked(service.saveCategory).mockResolvedValueOnce([category, child]);
    render(<CategoriesPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Criar subcategoria de Moradia (Despesa)",
      }),
    );
    expect(
      (screen.getByLabelText("Categoria principal") as HTMLSelectElement).value,
    ).toBe("1");
    fireEvent.change(screen.getByLabelText("Nome da categoria"), {
      target: { value: "Internet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));
    await screen.findByText("Categoria salva.");
    expect(service.saveCategory).toHaveBeenCalledWith({
      id: null,
      name: "Internet",
      kind: "expense",
      parentId: 1,
      icon: "tag",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar Moradia › Internet (Despesa)",
      }),
    );
    expect(
      within(screen.getByLabelText("Categoria principal")).queryByText(
        "Moradia › Internet",
      ),
    ).toBeNull();
    vi.mocked(service.saveCategory).mockResolvedValueOnce([
      category,
      { ...child, icon: "repeat" },
    ]);
    fireEvent.change(screen.getByLabelText("Ícone"), {
      target: { value: "repeat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.saveCategory).toHaveBeenLastCalledWith({
      id: 2,
      name: "Internet",
      kind: "expense",
      parentId: 1,
      icon: "repeat",
    });
    vi.mocked(service.setCategoryActive).mockResolvedValueOnce([
      category,
      { ...child, active: false },
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Arquivar Moradia › Internet (Despesa)",
      }),
    );
    await screen.findByText(
      "Categoria arquivada. Consulte Arquivadas para reativar.",
    );
    fireEvent.change(screen.getByLabelText("Exibir"), {
      target: { value: "archived" },
    });
    vi.mocked(service.setCategoryActive).mockResolvedValueOnce([
      category,
      child,
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reativar Moradia › Internet (Despesa)",
      }),
    );
    await screen.findByText("Categoria reativada.");
  });

  it("cria receita raiz e mostra erro de arquivamento sem retirar registros", async () => {
    vi.mocked(service.listCategories).mockResolvedValue([category]);
    vi.mocked(service.setCategoryActive).mockRejectedValueOnce(
      "Arquive as subcategorias primeiro.",
    );
    render(<CategoriesPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Arquivar Moradia (Despesa)" }),
    );
    await screen.findByText("Arquive as subcategorias primeiro.");
    expect(screen.getByText("Moradia")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nova categoria" }));
    fireEvent.change(screen.getByLabelText("Nome da categoria"), {
      target: { value: "Serviços" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de categoria"), {
      target: { value: "income" },
    });
    expect(
      within(screen.getByLabelText("Categoria principal")).queryByText(
        "Moradia",
      ),
    ).toBeNull();
    vi.mocked(service.saveCategory).mockResolvedValueOnce([
      category,
      { ...category, id: 3, name: "Serviços", kind: "income" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar categoria" }));
    await screen.findByText("Categoria salva.");
    expect(service.saveCategory).toHaveBeenLastCalledWith({
      id: null,
      name: "Serviços",
      kind: "income",
      parentId: null,
      icon: "tag",
    });
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "income" },
    });
    expect(screen.queryByText("Moradia")).toBeNull();
    expect(screen.getByText("Serviços")).toBeTruthy();
  });
});
