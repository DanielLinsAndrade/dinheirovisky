import { useRef, useState } from "react";
import {
  type Metadata,
  type MetadataKind,
  methodCodes,
  saveMetadata,
} from "../../services/metadata";
import { useMetadata } from "./NameAutocomplete";
export function MetadataManager({
  onBusy,
}: {
  onBusy: (busy: boolean) => void;
}) {
  const pending = useRef(false);
  const [kind, setKind] = useState<MetadataKind>("method"),
    [search, setSearch] = useState("");
  const { items, error, retry, loading } = useMetadata(kind, search, true);
  const [draft, setDraft] = useState<Metadata | null>(null),
    [name, setName] = useState(""),
    [code, setCode] = useState("other"),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [notice, setNotice] = useState("");
  async function save(input: Parameters<typeof saveMetadata>[0]) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setFailure("");
    setNotice("");
    try {
      await saveMetadata(input);
      setDraft(null);
      setName("");
      setNotice("Cadastro salvo.");
      retry();
    } catch (e) {
      setFailure(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section aria-label="Cadastros de metadados">
      <p>
        Editar nomes mantém os vínculos históricos. Arquivados permanecem nos
        lançamentos existentes.
      </p>
      <label htmlFor="metadata-kind">Cadastro</label>
      <select
        id="metadata-kind"
        value={kind}
        disabled={busy}
        onChange={(e) => {
          setKind(e.target.value as MetadataKind);
          setDraft(null);
          setName("");
          setSearch("");
        }}
      >
        <option value="method">Métodos de pagamento</option>
        <option value="merchant">Estabelecimentos</option>
        <option value="intermediary">Intermediários</option>
      </select>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            id: draft?.id ?? null,
            kind,
            name,
            code: kind === "method" ? code : null,
            active: draft?.active ?? true,
          });
        }}
      >
        <fieldset disabled={busy}>
          <legend>{draft ? "Editar cadastro" : "Novo cadastro"}</legend>
          <label htmlFor="metadata-name">Nome do cadastro</label>
          <input
            id="metadata-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {kind === "method" && (
            <>
              <label htmlFor="metadata-code">Tipo do método</label>
              <select
                id="metadata-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              >
                {Object.entries(methodCodes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          <button className="action primary" type="submit">
            Salvar cadastro
          </button>
          {draft && (
            <button
              className="action"
              type="button"
              onClick={() => {
                setDraft(null);
                setName("");
              }}
            >
              Cancelar edição
            </button>
          )}
        </fieldset>
      </form>
      {(failure || error) && (
        <div role="alert">
          {failure || error}
          {error && <button onClick={retry}>Tentar carregar cadastros</button>}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <label htmlFor="metadata-search">Pesquisar cadastros</label>
      <input
        id="metadata-search"
        value={search}
        maxLength={120}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="field-help">
        Até 100 resultados, incluindo arquivados. Refine a pesquisa para
        localizar outros nomes.
      </p>
      <ul className="metadata-list">
        {items.map((m) => (
          <li key={m.id}>
            <span>
              {m.name} · {m.active ? "Ativo" : "Arquivado"}
            </span>
            <button
              className="text-action"
              disabled={busy}
              onClick={() => {
                setDraft(m);
                setName(m.name);
                setCode(m.code ?? "other");
              }}
            >
              Editar {m.name}
            </button>
            <button
              className="text-action"
              disabled={busy || draft !== null}
              onClick={() => void save({ ...m, active: !m.active })}
            >
              {m.active ? "Arquivar" : "Reativar"} {m.name}
            </button>
          </li>
        ))}
      </ul>
      {loading && <p role="status">Carregando cadastros…</p>}
      {!items.length && !error && !loading && (
        <p>Nenhum cadastro encontrado.</p>
      )}
    </section>
  );
}
