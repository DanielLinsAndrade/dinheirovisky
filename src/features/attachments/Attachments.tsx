import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { Editor } from "../../components/Editor";
import { Button } from "../../components/Button";
import "./attachments.css";
import * as files from "../../services/attachments";
const PdfPreview = lazy(() => import("./PdfPreview"));
export function Attachments({
  kind,
  id,
  name,
  onClose,
}: {
  kind: files.AttachmentTarget;
  id: number;
  name: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<files.Attachment[] | null>(null),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [documentType, setDocumentType] = useState("proof"),
    [deleting, setDeleting] = useState<files.Attachment | null>(null),
    [preview, setPreview] = useState<{
      url: string;
      file: files.Attachment;
      bytes: Uint8Array;
    } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setError("");
    setItems(null);
    files.listAttachments(kind, id, page).then(
      (r) => {
        if (active) setItems(r);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [kind, id, page, revision]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Editor
      title={`Anexos — ${name}`}
      busy={busy}
      error={error}
      onClose={onClose}
    >
      <p>
        Imagem ou PDF, até 10 MiB por arquivo. Uma cópia é guardada no
        aplicativo; o original pode ser movido. Limite total: 64 MiB ou 1000
        anexos.
      </p>
      {notice && <p role="status">{notice}</p>}
      <label htmlFor="attachment-type">Tipo de documento</label>
      <select
        id="attachment-type"
        value={documentType}
        onChange={(e) => setDocumentType(e.target.value)}
        disabled={busy}
      >
        <option value="proof">Comprovante</option>
        <option value="receipt">Recibo</option>
        <option value="invoice">Nota fiscal</option>
        <option value="other">Outro documento financeiro</option>
      </select>
      <Button
        className="action"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const added = await files.addAttachment(kind, id, documentType);
            setNotice(
              added === null
                ? "Seleção cancelada."
                : "Anexo incorporado. Conteúdo idêntico no mesmo registro é reutilizado.",
            );
            if (added !== null) setRevision((n) => n + 1);
          })
        }
      >
        Adicionar anexo
      </Button>
      {!items && !error && <p role="status">Carregando anexos…</p>}
      {!items && error && (
        <Button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Tentar anexos novamente
        </Button>
      )}
      {items?.length === 0 && (
        <p>Nenhum anexo nesta página. Adicione um comprovante ou recibo.</p>
      )}
      <ul className="attachment-list">
        {items?.map((a) => (
          <li key={a.id}>
            <strong>{a.originalName}</strong> · {a.size} bytes{" "}
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await files.readAttachment(a.id);
                  const blob = new Blob([new Uint8Array(data.bytes)], {
                    type: data.attachment.mime,
                  });
                  setPreview({
                    url: URL.createObjectURL(blob),
                    file: data.attachment,
                    bytes: new Uint8Array(data.bytes),
                  });
                })
              }
            >
              Abrir {a.originalName}
            </Button>{" "}
            <Button disabled={busy} onClick={() => setDeleting(a)}>
              Remover {a.originalName}
            </Button>
          </li>
        ))}
      </ul>
      {deleting && (
        <div role="group" aria-label="Confirmar remoção de anexo">
          <p>
            Remover a cópia de {deleting.originalName}? O arquivo original não
            será alterado.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await files.removeAttachment(deleting.id);
                if (preview?.file.id === deleting.id) setPreview(null);
                setDeleting(null);
                setRevision((n) => n + 1);
                setNotice("Anexo removido.");
              })
            }
          >
            Confirmar remoção de anexo
          </Button>
          <Button disabled={busy} onClick={() => setDeleting(null)}>
            Manter anexo
          </Button>
        </div>
      )}
      {(page > 0 || items?.length === 50) && (
        <div className="list-tools">
          <Button
            disabled={busy || page === 0}
            onClick={() => setPage((n) => n - 1)}
          >
            Anexos anteriores
          </Button>
          <span>Página {page + 1}</span>
          <Button
            disabled={busy || items?.length !== 50}
            onClick={() => setPage((n) => n + 1)}
          >
            Próximos anexos
          </Button>
        </div>
      )}
      {preview && (
        <section aria-label="Visualização do anexo">
          <h3>{preview.file.originalName}</h3>
          {preview.file.mime === "application/pdf" ? (
            <Suspense fallback={<p role="status">Carregando leitor PDF…</p>}>
              <PdfPreview bytes={preview.bytes} />
            </Suspense>
          ) : (
            <img
              src={preview.url}
              alt={`Anexo ${preview.file.originalName}`}
              className="attachment-preview"
              onError={() =>
                setError(
                  "Não foi possível exibir esta imagem. O conteúdo armazenado foi preservado.",
                )
              }
            />
          )}
          <Button onClick={() => setPreview(null)}>Fechar visualização</Button>
        </section>
      )}
    </Editor>
  );
}
