import type { Page } from "../app/navigation";

const paths: Record<
  Page | "menu" | "search" | "income" | "expense" | "equal" | "calendar",
  string
> = {
  income: "M12 21V3 M5 10l7-7 7 7",
  expense: "M12 3v18 M5 14l7 7 7-7",
  equal: "M4 8h16 M4 16h16",
  calendar: "M4 5h16v16H4z M4 10h16 M8 2v6 M16 2v6",
  home: "m3 10 9-7 9 7v10H3z M9 20v-7h6v7",
  transactions: "M4 7h16m-4-4 4 4-4 4 M20 17H4m4-4-4 4 4 4",
  cards: "M3 5h18v14H3z M3 9h18 M6 15h4",
  accounts: "M3 7h17v14H3z M3 7V5l13-3v5 M16 12h5v5h-5z",
  categories: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  budgets: "M4 3h16v18H4z M8 7h8 M8 12h3 M8 17h3 M15 12h1 M15 17h1",
  recurrences:
    "M20 8a8 8 0 0 0-14-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 14 3l3-3 M16 16h5v5",
  goals: "M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l9-9 M16 3h5v5",
  reports: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-8",
  imports: "M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5",
  backup: "M5 5h14v15H5z M8 5V3h8v2 M8 10h8 M12 13v4m-2-2 2 2 2-2",
  settings: "M5 3v18 M12 3v18 M19 3v18 M2 8h6 M9 15h6 M16 8h6",
  about: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6 M12 7v1",
  menu: "M4 5h16v14H4z M9 5v14",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="ui-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
