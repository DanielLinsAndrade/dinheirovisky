import { useEffect, useState } from "react";
import { Editor } from "../components/Editor";
import {
  getSearchRecord,
  searchLabels,
  type SearchRecord,
} from "../services/search";
import { useFormatting } from "./SettingsContext";
const states: Record<string, string> = {
  active: "Ativo",
  archived: "Arquivado",
  posted: "Efetivado",
  pending: "Pendente",
  scheduled: "Programado",
};
export function SearchRecordDetail({
  target,
  onClose,
}: {
  target: Pick<SearchRecord, "kind" | "id">;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<SearchRecord | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const { formatMoney, displayDate } = useFormatting();
  useEffect(() => {
    let active = true;
    setError("");
    setRecord(null);
    getSearchRecord(target.kind, target.id).then(
      (r) => {
        if (active) setRecord(r);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [target.kind, target.id, retry]);
  return (
    <Editor
      title={`${searchLabels[target.kind]} — registro ${target.id}`}
      busy={false}
      error={error}
      onClose={onClose}
    >
      {record ? (
        <>
          <h3>{record.title}</h3>
          <p>{record.context}</p>
          <dl>
            {record.date && (
              <>
                <dt>Data</dt>
                <dd>{displayDate(record.date)}</dd>
              </>
            )}
            {record.amount && (
              <>
                <dt>Valor</dt>
                <dd>{formatMoney(BigInt(record.amount))}</dd>
              </>
            )}
            <dt>Situação</dt>
            <dd>{states[record.state] ?? record.state}</dd>
          </dl>
        </>
      ) : (
        !error && <p role="status">Carregando registro…</p>
      )}
      {error && (
        <button onClick={() => setRetry((n) => n + 1)}>
          Tentar registro novamente
        </button>
      )}
    </Editor>
  );
}
