import { sumMoney } from "../../domain/money";
import { useEffect, useRef, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Editor } from "../../components/Editor";
import {
  categoryPath,
  type Account,
  type Category,
} from "../../domain/catalog";
import { movementTypes, movementStatuses } from "../../domain/transactions";
import { listAccounts, listCategories } from "../../services/catalog";
import {
  csvHeaders,
  prepareImport,
  reviewImport,
  commitImport,
  readImportFile,
  type CsvOptions,
  type ImportPreview,
  type ImportRow,
} from "../../services/imports";
import { TransactionForm } from "../transactions/TransactionForm";
import { CsvMapping } from "./CsvMapping";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Confirmation = {
  id: string;
  rows: ImportRow[];
  duplicate: boolean;
  attempted: boolean;
  allow: boolean;
};

export function ImportPage() {
  const { formatMoney, displayDate, settings } = useFormatting();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("utf-8");
  const [format, setFormat] = useState("csv");
  const [accountId, setAccountId] = useState(0);
  const [options, setOptions] = useState<CsvOptions>({
    delimiter: ";",
    decimal: ",",
    dateFormat: "dd/MM/yyyy",
    dateColumn: 0,
    descriptionColumn: 1,
    amountColumn: 2,
    typeColumn: null,
  });
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [referencesBusy, setReferencesBusy] = useState(true);
  const [referencesError, setReferencesError] = useState("");
  const [referenceAttempt, setReferenceAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReferencesBusy(true);
    setReferencesError("");
    Promise.all([listAccounts(), listCategories()])
      .then(([a, c]) => {
        if (active) {
          setAccounts(a);
          setCategories(c);
          setAccountId(a.find((x) => x.active)?.id ?? 0);
        }
      })
      .catch((e) => {
        if (active) setReferencesError(message(e));
      })
      .finally(() => {
        if (active) setReferencesBusy(false);
      });
    return () => {
      active = false;
    };
  }, [referenceAttempt]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function reset() {
    setHeaders([]);
    setPreview(null);
    setSelected(new Set());
    setPage(0);
    setSuccess("");
    setError("");
  }
  async function content() {
    if (!file) throw new Error("Selecione um arquivo.");
    return readImportFile(file, encoding);
  }
  const accountName = (id: number | null) =>
    accounts.find((a) => a.id === id)?.name ?? "—";
  const categoryName = (id: number | null) => {
    const category = categories.find((c) => c.id === id);
    return category ? categoryPath(category, categories) : "Sem categoria";
  };
  const total = (kind: string) =>
    sumMoney(
      (confirmation?.rows ?? [])
        .filter((r) => r.movement.kind === kind)
        .map((r) => r.movement.amount),
    );
  return (
    <section className="import-page" aria-label="Importar extrato">
      <ol className="import-steps" aria-label="Etapas da importação">
        <li aria-current={!preview && !success ? "step" : undefined}>
          1. Selecionar arquivo
        </li>
        <li aria-current={preview ? "step" : undefined}>
          2. Revisar lançamentos
        </li>
        <li aria-current={success ? "step" : undefined}>
          3. Confirmar importação
        </li>
      </ol>
      <p>
        Importe CSV ou OFX localmente. Revise os lançamentos e confirme antes de
        gravar. Até 2 MB e 2000 lançamentos por arquivo.
      </p>
      {error && !confirmation && editing === null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {success && <p role="status">{success}</p>}
      {referencesBusy && <p role="status">Carregando contas e categorias…</p>}
      {referencesError && (
        <div role="alert">
          {referencesError}
          <button
            disabled={referencesBusy}
            onClick={() => setReferenceAttempt((n) => n + 1)}
          >
            Tentar carregar contas e categorias
          </button>
        </div>
      )}
      {!referencesBusy &&
        !referencesError &&
        !accounts.some((a) => a.active) && (
          <p>
            Crie ou reative uma conta na tela Contas antes de importar um
            extrato.
          </p>
        )}
      <fieldset
        disabled={
          busy ||
          !!preview ||
          referencesBusy ||
          !!referencesError ||
          !accounts.some((a) => a.active)
        }
      >
        <legend>Arquivo e interpretação</legend>
        <label>
          Arquivo{" "}
          <input
            type="file"
            accept=".csv,.ofx"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              reset();
              setFile(f);
              if (f)
                setFormat(
                  f.name.toLowerCase().endsWith(".ofx") ? "ofx" : "csv",
                );
            }}
          />
        </label>
        <label>
          Formato{" "}
          <select
            value={format}
            onChange={(e) => {
              reset();
              setFormat(e.target.value);
            }}
          >
            <option value="csv">CSV</option>
            <option value="ofx">OFX</option>
          </select>
        </label>
        <label>
          Codificação{" "}
          <select
            value={encoding}
            onChange={(e) => {
              reset();
              setEncoding(e.target.value);
            }}
          >
            <option value="utf-8">UTF-8</option>
            <option value="windows-1252">Windows-1252</option>
          </select>
        </label>
        <label>
          Conta do extrato{" "}
          <select
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            <option value={0}>Selecione</option>
            {accounts
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <p>
          Moeda: {settings.currency}. Confira se o arquivo pertence à conta
          escolhida. OFX de outra moeda será recusado.
        </p>
        {format === "csv" ? (
          <CsvMapping
            options={options}
            headers={headers}
            canRead={!!file}
            onChange={(next) => {
              if (next.delimiter !== options.delimiter) setHeaders([]);
              setOptions(next);
            }}
            onRead={() =>
              void run(async () =>
                setHeaders(
                  await csvHeaders(await content(), options.delimiter),
                ),
              )
            }
          />
        ) : (
          <p>
            Extratos bancários OFX XML/SGML, um extrato por arquivo, com FITID.
            Transferências exigem revisão manual de origem e destino; não são
            conciliadas automaticamente.
          </p>
        )}
        <button
          className="action primary"
          disabled={
            !file || !accountId || (format === "csv" && !headers.length)
          }
          onClick={() =>
            void run(async () => {
              const p = await prepareImport(
                await content(),
                format,
                format === "csv" ? options : null,
                accountId,
              );
              setPreview(p);
              setSelected(
                new Set(
                  p.rows.flatMap((r, i) =>
                    !r.error && !r.duplicate && !r.alreadyImported ? [i] : [],
                  ),
                ),
              );
              setPage(0);
            })
          }
        >
          Pré-visualizar
        </button>
      </fieldset>
      {preview && (
        <>
          <h2>Revisão — {file?.name}</h2>
          <p>
            {preview.source} · {preview.currency} · {preview.rows.length}{" "}
            registros · {selected.size} selecionados
          </p>
          <p>
            Possíveis duplicatas começam desmarcadas. FITIDs já importados não
            podem ser repetidos, mesmo após excluir a transação. Edite para
            corrigir dados e definir categorias.
          </p>
          <div className="toolbar">
            <button
              className="action"
              disabled={busy}
              onClick={() =>
                setSelected(
                  new Set(
                    preview.rows.flatMap((r, i) =>
                      !r.error && !r.duplicate && !r.alreadyImported ? [i] : [],
                    ),
                  ),
                )
              }
            >
              Selecionar válidos sem duplicatas
            </button>
            <button
              className="action"
              disabled={busy}
              onClick={() => setSelected(new Set())}
            >
              Limpar seleção
            </button>
            <button className="action" disabled={busy} onClick={reset}>
              Voltar ao arquivo
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Importar</th>
                  <th>Registro</th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Tipo / situação</th>
                  <th>Conta / destino</th>
                  <th>Categoria</th>
                  <th>Detalhes</th>
                  <th>Validação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .slice(page * 50, (page + 1) * 50)
                  .map((r, offset) => {
                    const i = page * 50 + offset,
                      m = r.row.movement;
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Importar registro ${r.row.line}`}
                            checked={selected.has(i)}
                            disabled={busy || !!r.error || r.alreadyImported}
                            onChange={(e) =>
                              setSelected((old) => {
                                const next = new Set(old);
                                if (e.target.checked) next.add(i);
                                else next.delete(i);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>{r.row.line}</td>
                        <td>{displayDate(m.date)}</td>
                        <td>{m.description}</td>
                        <td>
                          {formatMoney(m.amount)}
                          {r.error && (
                            <small> Original: {r.row.rawAmount}</small>
                          )}
                        </td>
                        <td>
                          {movementTypes[m.kind] ?? "Tipo inválido"} /{" "}
                          {movementStatuses[m.status]}
                        </td>
                        <td>
                          {accountName(m.accountId)}
                          {m.destinationAccountId && (
                            <> → {accountName(m.destinationAccountId)}</>
                          )}
                        </td>
                        <td>{categoryName(m.categoryId)}</td>
                        <td>
                          {[
                            m.details?.methodName,
                            m.details?.merchant,
                            m.details?.channel === "in_person"
                              ? "Presencial"
                              : m.details?.channel,
                            m.details?.intermediary,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Sem detalhes"}
                        </td>
                        <td>
                          {r.alreadyImported
                            ? "FITID já importado ou repetido"
                            : r.error ||
                              (r.duplicate ? "Possível duplicata" : "Válido")}
                        </td>
                        <td>
                          <button
                            className="action"
                            disabled={busy || r.alreadyImported}
                            onClick={() => {
                              setError("");
                              setEditing(i);
                            }}
                          >
                            Revisar registro {r.row.line}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <button
              className="action"
              disabled={busy || page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page + 1} de {Math.ceil(preview.rows.length / 50)}
            </span>
            <button
              className="action"
              disabled={busy || (page + 1) * 50 >= preview.rows.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
          <button
            className="action primary"
            disabled={busy || !selected.size}
            onClick={() =>
              void run(async () => {
                const reviewed = await reviewImport(
                  preview.rows
                    .filter((_, i) => selected.has(i))
                    .map((r) => r.row),
                  preview.currency,
                );
                const invalid = reviewed.find(
                  (r) => r.error || r.alreadyImported,
                );
                if (invalid)
                  throw new Error(
                    `Registro ${invalid.row.line}: ${invalid.error ?? "FITID já importado. Atualize a pré-visualização."}`,
                  );
                setConfirmation({
                  id: crypto.randomUUID(),
                  rows: reviewed.map((r) => r.row),
                  duplicate: reviewed.some((r) => r.duplicate),
                  attempted: false,
                  allow: false,
                });
              })
            }
          >
            Revisar confirmação
          </button>
        </>
      )}
      {preview && editing !== null && (
        <Editor
          modal={false}
          title={`Revisar registro ${preview.rows[editing].row.line}`}
          busy={busy}
          error={error}
          onClose={() => {
            setEditing(null);
            setError("");
          }}
        >
          <TransactionForm
            movement={preview.rows[editing].row.movement}
            accounts={accounts}
            categories={categories}
            busy={busy}
            onSave={async (movement) => {
              await run(async () => {
                const rows = preview.rows.map((r, i) =>
                  i === editing ? { ...r.row, movement } : r.row,
                );
                const reviewed = await reviewImport(rows, preview.currency);
                setPreview({ ...preview, rows: reviewed });
                setSelected(
                  (old) =>
                    new Set(
                      [...old].filter(
                        (i) =>
                          !reviewed[i].error && !reviewed[i].alreadyImported,
                      ),
                    ),
                );
                if (reviewed[editing].error)
                  throw new Error(reviewed[editing].error);
                setEditing(null);
              });
            }}
          />
        </Editor>
      )}
      {preview && confirmation && (
        <Editor
          title="Confirmar importação"
          busy={busy}
          error={error}
          onClose={() => {
            setConfirmation(null);
            setError("");
          }}
        >
          <p>
            {confirmation.rows.length} lançamentos serão gravados em{" "}
            {preview.currency}. Lançamentos efetivados alteram os saldos;
            transferências afetam origem e destino.
          </p>
          <p>
            Receitas: {formatMoney(total("income"))} · Despesas:{" "}
            {formatMoney(total("expense"))} · Transferências:{" "}
            {formatMoney(total("transfer"))}
          </p>
          {confirmation.duplicate && (
            <label>
              <input
                type="checkbox"
                checked={confirmation.allow}
                disabled={busy || confirmation.attempted}
                onChange={(e) =>
                  setConfirmation({ ...confirmation, allow: e.target.checked })
                }
              />
              Revisei e quero incluir as possíveis duplicatas selecionadas.
            </label>
          )}
          {confirmation.attempted && error && (
            <p>
              A confirmação mantém o mesmo identificador: tentar novamente não
              duplica um lote já gravado.
            </p>
          )}
          <button
            className="action primary"
            disabled={busy || (confirmation.duplicate && !confirmation.allow)}
            onClick={() =>
              void run(async () => {
                setConfirmation({ ...confirmation, attempted: true });
                const result = await commitImport(
                  confirmation.id,
                  confirmation.rows,
                  preview.currency,
                  confirmation.allow,
                );
                setConfirmation(null);
                setPreview(null);
                setSelected(new Set());
                setSuccess(
                  `${result.imported} lançamentos importados${result.repeated ? " (confirmação já processada)" : ""}. Consulte Transações para verificar os registros e saldos.`,
                );
              })
            }
          >
            {confirmation.attempted
              ? "Tentar confirmação novamente"
              : "Confirmar e importar"}
          </button>
        </Editor>
      )}
      {busy && <p role="status">Processando…</p>}
    </section>
  );
}
