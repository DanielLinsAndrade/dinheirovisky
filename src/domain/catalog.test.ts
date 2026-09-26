import { describe, expect, it } from "vitest";
import { availableParents, categoryPath, type Category } from "./catalog";
const rows: Category[] = [
  {
    id: 1,
    name: "Moradia",
    kind: "expense",
    parentId: null,
    icon: "home",
    active: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: 2,
    name: "Internet",
    kind: "expense",
    parentId: 1,
    icon: "tag",
    active: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: 3,
    name: "Salário",
    kind: "income",
    parentId: null,
    icon: "wallet",
    active: true,
    createdAt: "",
    updatedAt: "",
  },
];
describe("hierarquia de categorias", () => {
  it("mostra o caminho completo e exclui descendentes do seletor", () => {
    expect(categoryPath(rows[1], rows)).toBe("Moradia › Internet");
    expect(availableParents(rows, "expense", 1)).toEqual([]);
    expect(availableParents(rows, "expense", 2).map((row) => row.id)).toEqual([
      1,
    ]);
  });
  it("exclui pais arquivados e não entra em loop com resposta inconsistente", () => {
    expect(
      availableParents([{ ...rows[0], active: false }], "expense"),
    ).toEqual([]);
    expect(
      categoryPath({ ...rows[0], parentId: 1 }, [{ ...rows[0], parentId: 1 }]),
    ).toBe("Moradia");
  });
});
