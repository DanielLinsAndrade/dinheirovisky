import { Surface } from "../../components/Surface";
import { useRef, useState } from "react";
import { Editor } from "../../components/Editor";
import * as backup from "../../services/backup";
export function BackupPage() {
  const [preview, setPreview] = useState<backup.BackupPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState("");
  const pending = useRef(false);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Backup e restauração">
      <p>
        Guarde uma cópia completa dos dados em outra pasta ou dispositivo. O
        backup inclui configurações, recorrências, metas e históricos de
        importação e anexos gerenciados.
      </p>
      {error && !preview && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="database-path">
          {notice}
        </p>
      )}
      <div className="utility-grid">
        <Surface aria-label="Criar cópia de segurança">
          <h2>Backup completo</h2>
          <p>
            Pacote .dvbackup com snapshot SQLite, anexos e manifesto. Snapshot
            até 128 MiB. Escolha um nome novo: arquivos existentes não são
            sobrescritos. O arquivo contém seus dados financeiros sem
            criptografia.
          </p>
          <button
            className="action primary"
            disabled={busy || !!preview}
            onClick={() =>
              void run(async () => {
                const path = await backup.exportBackup();
                setNotice(
                  path ? `Backup salvo em ${path}` : "Operação cancelada.",
                );
              })
            }
          >
            Salvar backup
          </button>
        </Surface>
        <Surface aria-label="Exportação de dados">
          <h2>Exportar transações</h2>
          <p>
            CSV com todas as transações, contas, categorias, situações e moeda.
            Datas ISO e decimal com ponto. Não substitui um backup completo.
            Textos que poderiam virar fórmulas recebem um apóstrofo de proteção.
          </p>
          <button
            className="action"
            disabled={busy || !!preview}
            onClick={() =>
              void run(async () =>
                setNotice(
                  (await backup.exportTransactions()) ?? "Operação cancelada.",
                ),
              )
            }
          >
            Exportar CSV
          </button>
        </Surface>
        <Surface className="restore-surface" aria-label="Recuperação de dados">
          <h2>Restaurar backup</h2>
          <p>
            A restauração substitui todos os dados atuais pelos dados do backup.
            Aceita pacote v2 e backup SQLite legado. Primeiro o arquivo será
            validado; depois você poderá conferir o resumo e confirmar. Uma
            cópia do estado atual será preservada automaticamente antes da
            substituição.
          </p>
          <button
            className="action"
            disabled={busy || !!preview}
            onClick={() =>
              void run(async () => {
                const result = await backup.prepareRestore();
                setPreview(result);
                setConfirmed(false);
                if (!result) setNotice("Operação cancelada.");
              })
            }
          >
            Selecionar backup para restaurar
          </button>
        </Surface>
      </div>
      {busy && <p role="status">Processando arquivo… Aguarde a conclusão.</p>}
      {preview && (
        <Editor
          title="Confirmar restauração"
          busy={busy}
          error={error}
          onClose={() =>
            void run(async () => {
              await backup.cancelRestore();
              setPreview(null);
              setConfirmed(false);
            })
          }
        >
          <p>
            Backup validado: {preview.accounts} contas, {preview.transactions}{" "}
            transações, {preview.attachments} anexos, moeda {preview.currency},
            schema de origem {preview.originalVersion}.
          </p>
          <p>
            Contas, transações, categorias, orçamento, metas, recorrências,
            configurações, anexos e históricos atuais serão substituídos. Um
            backup de segurança será salvo na pasta local da aplicação.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Entendo que os dados atuais serão substituídos.
          </label>
          <button
            className="action primary"
            disabled={busy || !confirmed}
            onClick={() =>
              void run(async () => {
                const path = await backup.confirmRestore(
                  preview.token,
                  confirmed,
                );
                setPreview(null);
                setRecovery(path);
              })
            }
          >
            Restaurar e substituir dados
          </button>
        </Editor>
      )}
      {recovery && (
        <Editor
          title="Restauração concluída"
          busy={false}
          error=""
          onClose={() => window.location.reload()}
        >
          <p>
            Os dados foram restaurados. Recarregue a aplicação para aplicar as
            configurações e atualizar todas as telas.
          </p>
          <p className="database-path">
            Cópia de segurança anterior: {recovery}
          </p>
          <button
            className="action primary"
            onClick={() => window.location.reload()}
          >
            Recarregar aplicação
          </button>
        </Editor>
      )}
    </section>
  );
}
