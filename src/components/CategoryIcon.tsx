import type { CategoryIconName } from "../domain/catalog";

const paths: Record<CategoryIconName, string> = {
  tag: "M3 3h7l11 11-7 7L3 10V3z M7 7h.01",
  food: "M4 3v6c0 3 6 3 6 0V3 M7 3v18 M18 3v18 M18 3c-5 3-5 10 0 10",
  home: "m3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8",
  car: "m5 4-2 9v6h18v-6l-2-9H5z M3 12h18 M7 16h.01 M17 16h.01 M5 19v2 M19 19v2",
  heart: "M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 3 11 8 15 5-4 13-10 8-15z",
  book: "M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1v15",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 1 1 10 0",
  repeat: "M3 7h16l-4-4 M21 17H5l4 4 M19 7v5 M5 17v-5",
  bag: "M4 7h16l1 14H3L4 7z M8 8V6a4 4 0 0 1 8 0v2",
  briefcase: "M3 7h18v14H3V7z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3",
  chart: "M3 3v18h18 M7 16l4-5 4 2 6-8",
  refund: "M7 3 3 7l4 4 M3 7h10a7 7 0 1 1 0 14H8",
  wallet: "M3 5h17v16H3V5z M3 5l14-3v3 M15 11h6v5h-6v-5z",
};
export function CategoryIcon({ name }: { name: CategoryIconName }) {
  return (
    <svg
      className="category-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.tag} />
    </svg>
  );
}
