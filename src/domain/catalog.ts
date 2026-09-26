export const accountTypes = {
  wallet: "Carteira",
  checking: "Conta corrente",
  savings: "Poupança",
  digital: "Conta digital",
  investment: "Investimento",
  other: "Outros",
} as const;
export type AccountKind = keyof typeof accountTypes;
export type CategoryKind = "income" | "expense";
export const categoryTypes = { income: "Receita", expense: "Despesa" } as const;
export const categoryIcons = {
  tag: "Etiqueta",
  food: "Alimentação",
  home: "Moradia",
  car: "Transporte",
  heart: "Saúde",
  book: "Educação",
  sun: "Lazer",
  repeat: "Assinatura",
  bag: "Compras",
  briefcase: "Trabalho",
  chart: "Rendimentos",
  refund: "Reembolso",
  wallet: "Carteira",
} as const;
export type CategoryIconName = keyof typeof categoryIcons;

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  initialBalance: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface AccountInput {
  id: number | null;
  name: string;
  kind: AccountKind;
  initialBalance: number;
}
export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  parentId: number | null;
  icon: CategoryIconName;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CategoryInput {
  id: number | null;
  name: string;
  kind: CategoryKind;
  parentId: number | null;
  icon: CategoryIconName;
}

export function categoryPath(
  category: Category,
  categories: Category[],
): string {
  const names = [category.name];
  const visited = new Set([category.id]);
  let parentId = category.parentId;
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = categories.find((item) => item.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" › ");
}

export function availableParents(
  categories: Category[],
  kind: CategoryKind,
  editingId?: number,
  active = true,
): Category[] {
  return categories.filter((candidate) => {
    if (candidate.kind !== kind || (active && !candidate.active)) return false;
    let current: Category | undefined = candidate;
    const visited = new Set<number>();
    while (current) {
      if (current.id === editingId || visited.has(current.id)) return false;
      visited.add(current.id);
      const parentId: number | null = current.parentId;
      current = categories.find((item) => item.id === parentId);
    }
    return true;
  });
}
