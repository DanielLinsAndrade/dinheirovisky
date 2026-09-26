import { useEffect, useState, type ReactNode } from "react";
import { Brand } from "../components/Brand";
import { Button, IconButton } from "../components/Button";
import { Icon } from "../components/Icon";
import { CommandPalette } from "./CommandPalette";
import { ThemeControl } from "./ThemeControl";
import { navigationGroups, type Page } from "./navigation";
import type { SearchRecord } from "../services/search";

export function AppShell({
  page,
  onNavigate,
  children,
  onOpenRecord,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
  onOpenRecord?: (record: SearchRecord) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia?.("(max-width: 900px)").matches ?? false,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 900px)");
    const resize = () => setCollapsed(media?.matches ?? false);
    media?.addEventListener("change", resize);
    return () => media?.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.repeat &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const navigate = (target: Page) => {
    setPaletteOpen(false);
    if (window.matchMedia?.("(max-width: 700px)").matches) setCollapsed(true);
    onNavigate(target);
  };
  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>
      <aside className="sidebar" aria-label="Barra lateral">
        <div className="sidebar-brand" aria-label="Dinheirovisky">
          <Brand />
          <small className="brand-slogan">Seu bolso agradece.</small>
        </div>
        <nav
          id="sidebar-navigation"
          className="sidebar-navigation"
          aria-label="Navegação principal"
        >
          {navigationGroups.map((group) => (
            <section
              className="navigation-group"
              key={group.label}
              aria-label={group.label}
            >
              <h2 className="navigation-group-title">{group.label}</h2>
              {group.items.map((item) => (
                <Button
                  variant="quiet"
                  className="navigation-item"
                  key={item.id}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  aria-current={page === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <Icon name={item.id} />
                  <span className="navigation-label">{item.label}</span>
                </Button>
              ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <IconButton
            variant="quiet"
            label={collapsed ? "Expandir navegação" : "Recolher navegação"}
            aria-expanded={!collapsed}
            aria-controls="sidebar-navigation"
            onClick={() => setCollapsed((value) => !value)}
          >
            <Icon name="menu" />
          </IconButton>
          <span className="sidebar-caption">Seu bolso agradece.</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-toolbar">
          <Button
            variant="quiet"
            aria-keyshortcuts="Control+k"
            onClick={() => {
              if (!document.querySelector("dialog[open]")) setPaletteOpen(true);
            }}
          >
            <Icon name="search" />
            Ir para… <kbd>Ctrl K</kbd>
          </Button>
          <ThemeControl />
        </header>
        {children}
      </div>
      {paletteOpen && (
        <CommandPalette
          onOpen={
            onOpenRecord
              ? (record) => {
                  setPaletteOpen(false);
                  onOpenRecord(record);
                }
              : undefined
          }
          onNavigate={navigate}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
