import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BackupPreview } from "../services/backup";

export function StorageGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [directory, setDirectory] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const retry = () =>
    run(async () => {
      setPreview(null);
      if (!isTauri())
        throw new Error(
          "Abra a aplicação desktop com npm run tauri dev para acessar o banco local.",
        );
      const status = await invoke<{
        ready: boolean;
        error: string | null;
        directory: string | null;
      }>("storage_status");
      setDirectory(status.directory ?? "");
      setError(status.error ?? "");
      setReady(status.ready);
    });
  useEffect(() => {
    void retry();
  }, []);
  if (ready) return children;
  return (
    <main className="app-shell">
      <h1>Armazenamento do Dinheirovisky</h1>
      {busy && <p role="status">Verificando armazenamento…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && (
        <p>
          Verifique o acesso à pasta e tente novamente. Se o banco estiver
          inválido, selecione um backup oficial. A recuperação cria uma nova
          cópia e mantém os arquivos anteriores, inclusive WAL e SHM, para
          análise. Não apague esses arquivos.
        </p>
      )}
      {directory && <p>Pasta de dados: {directory}</p>}
      <button disabled={busy} onClick={() => void retry()}>
        Tentar abrir novamente
      </button>
      <button
        disabled={busy || !isTauri()}
        onClick={() =>
          void run(async () => {
            setPreview(null);
            setConfirmed(false);
            setPreview(await invoke<BackupPreview | null>("prepare_recovery"));
          })
        }
      >
        Selecionar backup para recuperação
      </button>
      {preview && (
        <section aria-label="Confirmar recuperação">
          <h2>Backup validado</h2>
          <p>
            {preview.accounts} conta(s), {preview.transactions} transação(ões),
            moeda {preview.currency}. Versão original: {preview.originalVersion}
            .
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Usar os dados deste backup como banco ativo, preservando o banco
            anterior.
          </label>
          <button
            disabled={busy || !confirmed}
            onClick={() =>
              void run(async () => {
                await invoke("confirm_recovery", {
                  token: preview.token,
                  confirmed,
                });
                setReady(true);
              })
            }
          >
            Confirmar recuperação
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await invoke("cancel_recovery");
                setPreview(null);
                setConfirmed(false);
              })
            }
          >
            Cancelar recuperação
          </button>
        </section>
      )}
    </main>
  );
}
