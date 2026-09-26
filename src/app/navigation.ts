export const navigationGroups = [
  {
    label: "Principal",
    items: [
      { id: "home", label: "Início", title: "Dashboard" },
      { id: "transactions", label: "Transações", title: "Transações" },
      { id: "accounts", label: "Contas", title: "Contas" },
      { id: "cards", label: "Cartões", title: "Cartões" },
      { id: "categories", label: "Categorias", title: "Categorias" },
    ],
  },
  {
    label: "Planejamento",
    items: [
      { id: "budgets", label: "Orçamento", title: "Orçamento" },
      { id: "recurrences", label: "Recorrências", title: "Recorrências" },
      { id: "goals", label: "Metas", title: "Metas" },
      { id: "reports", label: "Relatórios", title: "Relatórios" },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { id: "imports", label: "Importar", title: "Importação" },
      {
        id: "backup",
        label: "Backup e restauração",
        title: "Backup e restauração",
      },
      { id: "settings", label: "Configurações", title: "Configurações" },
      { id: "about", label: "Sobre", title: "Sobre o Dinheirovisky" },
    ],
  },
] as const;

export const navigationItems = navigationGroups.flatMap((group) => [
  ...group.items,
]);
export type Page = (typeof navigationItems)[number]["id"];
export const pageTitle = (page: Page) =>
  navigationItems.find((item) => item.id === page)!.title;
