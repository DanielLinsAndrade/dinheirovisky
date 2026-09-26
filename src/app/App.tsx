import { CardsPage } from "../features/cards/CardsPage";
import { useSettings } from "./SettingsContext";
import { localDate } from "../domain/transactions";
import { useEffect, useRef, useState } from "react";
import {
  ConnectionStatus,
  type Connection,
} from "../components/ConnectionStatus";
import { getAppStatus, type AppStatus } from "../services/desktop";
import { AccountsPage } from "../features/accounts/AccountsPage";
import { CategoriesPage } from "../features/categories/CategoriesPage";
import "../features/catalog.css";
import { TransactionsPage } from "../features/transactions/TransactionsPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { BudgetsPage } from "../features/budgets/BudgetsPage";
import { GoalsPage } from "../features/planning/GoalsPage";
import { RecurrencesPage } from "../features/planning/RecurrencesPage";
import { ReportWorkspace } from "../features/reports/ReportWorkspace";
import { ImportWorkspace } from "../features/imports/ImportWorkspace";
import { BackupPage } from "../features/backup/BackupPage";
import { AppShell } from "./AppShell";
import { pageTitle, type Page } from "./navigation";
import { SearchRecordDetail } from "./SearchRecordDetail";
import type { SearchRecord, SearchKind } from "../services/search";
import type { PlanningOrigin } from "../services/commitments";
import { ConsumptionComparison } from "../features/planning/ConsumptionComparison";
const searchPages: Record<SearchKind, Page> = {
  transaction: "transactions",
  account: "accounts",
  category: "categories",
  card: "cards",
  merchant: "transactions",
};

export function App() {
  const { settings } = useSettings();
  const [page, setPage] = useState<Page>("home");
  const [connection, setConnection] = useState<Connection>({
    state: "loading",
  });
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [historyAccount, setHistoryAccount] = useState<number>();
  const [createRequested, setCreateRequested] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [searchRecord, setSearchRecord] = useState<Pick<
    SearchRecord,
    "kind" | "id"
  > | null>(null);
  const [planningOrigin, setPlanningOrigin] = useState<PlanningOrigin | null>(
    null,
  );
  function openPlanningOrigin(origin: PlanningOrigin) {
    setPlanningOrigin(origin);
    setHistoryAccount(undefined);
    setCreateRequested(false);
    if (origin.kind === "transaction" && origin.id !== null) {
      setSearchRecord({ kind: "transaction", id: origin.id });
      setPage("transactions");
    } else if (origin.kind === "invoice") setPage("cards");
    else if (origin.kind === "recurrence") setPage("recurrences");
    else if (origin.kind === "budget") setPage("budgets");
  }

  useEffect(() => {
    let active = true;
    setConnection({ state: "loading" });
    setStatus(null);
    getAppStatus().then(
      (result) => {
        if (active) {
          setStatus(result);
          setConnection({ state: "ready" });
        }
      },
      (error: unknown) => {
        if (active) {
          setConnection({
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!document.querySelector("dialog[open]")) heading.current?.focus();
  }, [page]);

  return (
    <AppShell
      onOpenRecord={(record) => {
        setHistoryAccount(undefined);
        setCreateRequested(false);
        setPage(searchPages[record.kind]);
        setSearchRecord(record);
      }}
      page={page}
      onNavigate={(target) => {
        setPlanningOrigin(null);
        if (target === "transactions") {
          setHistoryAccount(undefined);
          setCreateRequested(false);
        }
        setPage(target);
        queueMicrotask(() => heading.current?.focus());
      }}
    >
      <main id="content" tabIndex={-1} data-page={page}>
        {planningOrigin?.kind === "report" &&
          planningOrigin.month &&
          planningOrigin.comparisonMonth && (
            <ConsumptionComparison
              month={planningOrigin.month}
              comparison={planningOrigin.comparisonMonth}
              onClose={() => setPlanningOrigin(null)}
            />
          )}
        {searchRecord && (
          <SearchRecordDetail
            target={searchRecord}
            onClose={() => {
              setSearchRecord(null);
              queueMicrotask(() => heading.current?.focus());
            }}
          />
        )}
        <header className="page-heading">
          <div>
            <h1 ref={heading} tabIndex={-1} aria-label={pageTitle(page)}>
              {page === "home"
                ? new Date().getHours() < 12
                  ? "Bom dia."
                  : new Date().getHours() < 18
                    ? "Boa tarde."
                    : "Boa noite."
                : pageTitle(page)}
            </h1>
            {page === "home" && <p>Seu dinheiro, com clareza.</p>}
          </div>
          {page === "home" && (
            <time dateTime={localDate()}>
              {new Intl.DateTimeFormat(settings.locale, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </time>
          )}
        </header>
        {page === "home" ? (
          <DashboardPage
            onOrigin={openPlanningOrigin}
            onGoals={() => setPage("goals")}
            onReports={() => setPage("reports")}
            onNewTransaction={() => {
              setHistoryAccount(undefined);
              setCreateRequested(true);
              setPage("transactions");
            }}
            onAccounts={() => setPage("accounts")}
            onTransactions={() => {
              setHistoryAccount(undefined);
              setPage("transactions");
            }}
          />
        ) : page === "backup" ? (
          <BackupPage />
        ) : page === "imports" ? (
          <ImportWorkspace />
        ) : page === "reports" ? (
          <ReportWorkspace />
        ) : page === "goals" ? (
          <GoalsPage />
        ) : page === "recurrences" ? (
          <RecurrencesPage
            initialId={
              planningOrigin?.kind === "recurrence"
                ? (planningOrigin.id ?? undefined)
                : undefined
            }
            onTransactions={() => {
              setHistoryAccount(undefined);
              setPage("transactions");
            }}
          />
        ) : page === "budgets" ? (
          <BudgetsPage
            initialCategoryId={
              planningOrigin?.kind === "budget"
                ? (planningOrigin.id ?? undefined)
                : undefined
            }
            initialMonth={
              planningOrigin?.kind === "budget"
                ? (planningOrigin.month ?? undefined)
                : undefined
            }
          />
        ) : page === "settings" ? (
          <SettingsPage />
        ) : page === "cards" ? (
          <CardsPage
            initialCardId={
              planningOrigin?.kind === "invoice"
                ? (planningOrigin.cardId ?? undefined)
                : undefined
            }
            initialInvoiceId={
              planningOrigin?.kind === "invoice"
                ? (planningOrigin.id ?? undefined)
                : undefined
            }
          />
        ) : page === "accounts" ? (
          <AccountsPage
            onHistory={(id) => {
              setHistoryAccount(id);
              setPage("transactions");
            }}
          />
        ) : page === "transactions" ? (
          <TransactionsPage
            createRequested={createRequested}
            onRequestHandled={() => setCreateRequested(false)}
            key={historyAccount ?? "all"}
            accountId={historyAccount}
          />
        ) : page === "categories" ? (
          <CategoriesPage />
        ) : (
          <section className="about" aria-label="Informações da aplicação">
            <p className="brand-tagline">Seu bolso agradece.</p>
            <p className="intro">
              Uso pessoal, local e sem login. Os dados ficam neste computador.
            </p>
            <ConnectionStatus connection={connection} />
            {status && (
              <dl>
                <div>
                  <dt>Versão da aplicação</dt>
                  <dd>{status.appVersion}</dd>
                </div>
                <div>
                  <dt>Versão do schema</dt>
                  <dd>{status.schemaVersion}</dd>
                </div>
                <div>
                  <dt>SQLite</dt>
                  <dd>{status.sqliteVersion}</dd>
                </div>
                <div>
                  <dt>Arquivo de dados</dt>
                  <dd className="database-path">{status.databasePath}</dd>
                </div>
              </dl>
            )}
            <button
              className="action"
              disabled={connection.state === "loading"}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Verificar conexão
            </button>
          </section>
        )}
        {connection.state === "error" && (
          <div className="error-message" role="alert">
            <h2>Não foi possível acessar o banco local.</h2>
            <p>{connection.message}</p>
            <button
              className="action"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </div>
        )}
      </main>
      <footer>
        Dados locais. Sem serviços externos nas funcionalidades principais.
      </footer>
    </AppShell>
  );
}
