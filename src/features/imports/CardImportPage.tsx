import { useEffect, useRef, useState } from "react";
import { useFormatting } from "../../app/SettingsContext";
import { Editor } from "../../components/Editor";
import type { CreditCard } from "../../domain/cards";
import type { Category } from "../../domain/catalog";
import { listCards } from "../../services/cards";
import { listCategories } from "../../services/catalog";
import {
  commitCardImport,
  csvHeaders,
  prepareCardImport,
  readImportFile,
  reviewCardImport,
  type CardImportPreview,
  type CardImportRow,
} from "../../services/imports";
import { PurchaseForm } from "../cards/PurchaseForm";
import { CsvMapping, defaultCsvOptions } from "./CsvMapping";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Confirmation = {
  id: string;
  rows: CardImportRow[];
  duplicate: boolean;
  allow: boolean;
  attempted: boolean;
};

export function CardImportPage() {
  const { formatMoney, displayDate } = useFormatting();
  const [cards, setCards] = useState<CreditCard[]>([]),
    [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true),
    [catalogError, setCatalogError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [cardId, setCardId] = useState(0),
    [file, setFile] = useState<File | null>(null),
    [format, setFormat] = useState("csv"),
    [encoding, setEncoding] = useState("utf-8");
  const [options, setOptions] = useState(defaultCsvOptions),
    [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<CardImportPreview | null>(null),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null),
    [sourceCard, setSourceCard] = useState(""),
    [firstInvoice, setFirstInvoice] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setCatalogError("");
    Promise.all([listCards(), listCategories()])
      .then(([c, k]) => {
        if (active) {
          setCards(c);
          setCategories(k);
          setCardId(c.find((c) => c.active)?.id ?? 0);
        }
      })
      .catch((e) => {
        if (active) setCatalogError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
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
    setPreview(null);
    setSelected(new Set());
    setPage(0);
    setHeaders([]);
    setError("");
    setSuccess("");
  }
  async function content() {
    if (!file) throw new Error("Selecione um arquivo.");
    return readImportFile(file, encoding);
  }
  return (
    <section className="import-page" aria-label="Importar compras no cartão">
      <p>
        Importe compras originais, com data e valor integral. Não importe
        parcelas isoladas, pagamentos de fatura, créditos ou estornos como
        compras. Até 2 MB e 2000 registros. A importação não movimenta saldo
        bancário.
      </p>
      {loading && <p role="status">Carregando cartões e categorias…</p>}
      {catalogError && (
        <div role="alert">
          {catalogError}
          <button onClick={() => setAttempt((n) => n + 1)}>
            Tentar carregar cartões
          </button>
        </div>
      )}
      {!loading && !catalogError && !cards.some((c) => c.active) && (
        <p>Cadastre ou reative um cartão antes de importar compras.</p>
      )}
      {error && editing === null && !confirmation && (
        <p role="alert">{error}</p>
      )}
      {success && <p role="status">{success}</p>}
      <fieldset
        disabled={
          busy ||
          loading ||
          !!catalogError ||
          !!preview ||
          !cards.some((c) => c.active)
        }
      >
        <legend>Arquivo de compras e interpretação</legend>
        <label>
          Arquivo{" "}
          <input
            type="file"
            accept=".csv,.ofx"
            onChange={(e) => {
              reset();
              const f = e.target.files?.[0] ?? null;
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
          Cartão do arquivo{" "}
          <select
            value={cardId}
            onChange={(e) => setCardId(Number(e.target.value))}
          >
            <option value={0}>Selecione</option>
            {cards
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id!}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        {format === "csv" ? (
          <CsvMapping
            card
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
            OFX não informa de forma confiável o parcelamento e a data original.
            Cada compra exige revisão; FITIDs já importados continuam bloqueados
            após cancelamento.
          </p>
        )}
        <button
          className="action primary"
          disabled={!file || !cardId || (format === "csv" && !headers.length)}
          onClick={() =>
            void run(async () => {
              setSuccess("");
              setPreview(
                await prepareCardImport(
                  await content(),
                  format,
                  format === "csv" ? options : null,
                  cardId,
                ),
              );
              setPage(0);
              setSelected(new Set());
            })
          }
        >
          Pré-visualizar compras
        </button>
      </fieldset>
      {preview && (
        <>
          <h2>Revisão de compras — {file?.name}</h2>
          <p>
            {preview.source} · {preview.currency} · {selected.size} selecionadas
          </p>
          <p>
            Revise cada compra e confirme o valor integral e o parcelamento. A
            primeira fatura é calculada pelo calendário do cartão; divergências
            precisam ser resolvidas antes de importar.
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
              Selecionar válidas sem duplicatas
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
                  <th>Compra</th>
                  <th>Valor integral / parcelas</th>
                  <th>Primeira fatura</th>
                  <th>Validação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .slice(page * 50, (page + 1) * 50)
                  .map((r, offset) => {
                    const i = page * 50 + offset;
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Importar compra ${r.row.line}`}
                            disabled={busy || !!r.error || r.alreadyImported}
                            checked={selected.has(i)}
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
                        <td>
                          {r.row.purchase.description}
                          <br />
                          {displayDate(r.row.purchase.date)}
                        </td>
                        <td>
                          {formatMoney(r.row.purchase.amount)} /{" "}
                          {r.row.purchase.installmentCount || "não informado"}
                          <small> Original: {r.row.rawAmount}</small>
                        </td>
                        <td>{r.calculatedInvoice ?? "A revisar"}</td>
                        <td>
                          {r.alreadyImported
                            ? "FITID já importado"
                            : r.error ||
                              (r.duplicate ? "Possível duplicata" : "Válida")}
                        </td>
                        <td>
                          <button
                            className="action"
                            disabled={busy || r.alreadyImported}
                            onClick={() => {
                              setEditing(i);
                              setError("");
                              setSourceCard(r.row.sourceCard ?? "");
                              setFirstInvoice(r.row.firstInvoice ?? "");
                              setConfirmed(r.row.confirmedPurchase);
                            }}
                          >
                            Revisar compra {r.row.line}
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
                const rows = await reviewCardImport(
                  preview.rows
                    .filter((_, i) => selected.has(i))
                    .map((r) => r.row),
                  preview.currency,
                );
                const invalid = rows.find((r) => r.error || r.alreadyImported);
                if (invalid)
                  throw new Error(invalid.error ?? "FITID já importado.");
                setConfirmation({
                  id: crypto.randomUUID(),
                  rows: rows.map((r) => r.row),
                  duplicate: rows.some((r) => r.duplicate),
                  allow: false,
                  attempted: false,
                });
              })
            }
          >
            Revisar confirmação de compras
          </button>
        </>
      )}
      {preview && editing !== null && (
        <Editor
          modal={false}
          title={`Revisar compra ${preview.rows[editing].row.line}`}
          busy={busy}
          error={error}
          onClose={() => {
            setEditing(null);
            setError("");
          }}
        >
          <fieldset disabled={busy}>
            <legend>Conferência da origem</legend>
            <p>
              Cartão selecionado: {cards.find((c) => c.id === cardId)?.name}.
              Confira a associação com o arquivo.
            </p>
            <label>
              Nome do cartão na origem{" "}
              <input
                value={sourceCard}
                maxLength={120}
                onChange={(e) => {
                  setSourceCard(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              Primeira fatura na origem{" "}
              <input
                type="month"
                value={firstInvoice}
                onChange={(e) => {
                  setFirstInvoice(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <p>
              Se a origem não informar fatura, deixe em branco e confira o mês
              calculado na prévia. Para trocar o cartão selecionado, volte ao
              arquivo.
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Conferi a origem: data e valor são da compra integral; a
              quantidade informa todas as parcelas, inclusive 1 para compra à
              vista.
            </label>
          </fieldset>
          <PurchaseForm
            cardId={cardId}
            purchase={preview.rows[editing].row.purchase}
            categories={categories}
            busy={busy}
            onSave={async (purchase) => {
              await run(async () => {
                if (!confirmed)
                  throw new Error("Confirme os dados da compra original.");
                const rows = preview.rows.map((r, i) =>
                  i === editing
                    ? {
                        ...r.row,
                        purchase,
                        sourceCard: sourceCard.trim() || null,
                        firstInvoice: firstInvoice || null,
                        confirmedPurchase: confirmed,
                      }
                    : r.row,
                );
                const reviewed = await reviewCardImport(rows, preview.currency);
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
          title="Confirmar importação de compras"
          busy={busy}
          error={error}
          onClose={() => {
            setConfirmation(null);
            setError("");
          }}
        >
          <p>
            {confirmation.rows.length} compras serão registradas com suas
            parcelas. Pagamento da fatura será registrado separadamente, sem
            duplicar a despesa.
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
              Nova tentativa mantém a mesma confirmação e não duplica um lote já
              gravado.
            </p>
          )}
          <button
            className="action primary"
            disabled={busy || (confirmation.duplicate && !confirmation.allow)}
            onClick={() =>
              void run(async () => {
                setConfirmation({ ...confirmation, attempted: true });
                const result = await commitCardImport(
                  confirmation.id,
                  confirmation.rows,
                  preview.currency,
                  confirmation.allow,
                );
                setConfirmation(null);
                setPreview(null);
                setSelected(new Set());
                setSuccess(
                  `${result.imported} compras importadas${result.repeated ? " (confirmação já processada)" : ""}. Consulte Cartões para conferir compras e faturas.`,
                );
              })
            }
          >
            {confirmation.attempted
              ? "Tentar confirmação novamente"
              : "Confirmar e importar compras"}
          </button>
        </Editor>
      )}
      {busy && <p role="status">Processando…</p>}
    </section>
  );
}
