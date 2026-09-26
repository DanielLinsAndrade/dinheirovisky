import { useLayoutEffect, useRef, useState } from "react";
import { Editor } from "../components/Editor";
import { SearchInput } from "../components/SearchInput";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { navigationItems, type Page } from "./navigation";
import { SearchResults } from "./SearchResults";
import type { SearchRecord } from "../services/search";

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

export function CommandPalette({
  onNavigate,
  onClose,
  onOpen,
}: {
  onNavigate: (page: Page) => void;
  onClose: () => void;
  onOpen?: (record: SearchRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const matches = navigationItems.filter((item) =>
    normalize(`${item.label} ${item.title}`).includes(normalize(query.trim())),
  );
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <Editor
      title={onOpen ? "Busca e navegação" : "Ir para uma página"}
      busy={false}
      error=""
      onClose={onClose}
      className="command-dialog"
      dismissOnBackdrop
    >
      <SearchInput
        label={onOpen ? "Buscar registros e páginas" : "Filtrar páginas"}
        ref={input}
        value={query}
        maxLength={120}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            results.current
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
          }
          if (e.key === "Enter" && matches.length === 1) {
            e.preventDefault();
            onNavigate(matches[0].id);
          }
        }}
      />
      <p className="field-help">
        {onOpen
          ? "Busque registros ou navegue pelas páginas. "
          : "Navegue pelas páginas do aplicativo. "}
        Use Tab ou as setas para escolher.
      </p>
      {!onOpen && matches.length === 0 && (
        <p role="status" className="command-empty">
          Nenhuma página encontrada.
        </p>
      )}
      <ul
        ref={results}
        className="command-results"
        aria-label={
          onOpen ? "Registros e páginas disponíveis" : "Páginas disponíveis"
        }
        onKeyDown={(e) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const buttons = Array.from(
            results.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (index < 0) return;
          e.preventDefault();
          if (e.key === "ArrowUp" && index === 0) {
            input.current?.focus();
            return;
          }
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }}
      >
        {onOpen && <SearchResults key={query} query={query} onOpen={onOpen} />}
        {matches.map((item) => (
          <li key={item.id}>
            <Button variant="quiet" onClick={() => onNavigate(item.id)}>
              <Icon name={item.id} />
              {item.label}
            </Button>
          </li>
        ))}
      </ul>
    </Editor>
  );
}
