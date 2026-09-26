import { useEffect, useRef, useState } from "react";
import {
  queryTransactions,
  type TransactionQuery,
  type TransactionPage,
} from "../../services/transactions";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useTransactions(query: TransactionQuery) {
  const key = JSON.stringify(query);
  const [data, setData] = useState<TransactionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false),
    pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      queryTransactions(JSON.parse(key) as TransactionQuery)
        .then(
          (result) => {
            if (active) setData(result);
          },
          (e) => {
            if (active) setError(message(e));
          },
        )
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, revision]);
  async function mutate(operation: () => Promise<void>, success: string) {
    if (pending.current) return false;
    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await operation();
      if (mounted.current) {
        setNotice(success);
        setRevision((n) => n + 1);
      }
      // A gravação foi confirmada. Falha posterior de consulta não deve induzir
      // reenvio do mesmo lançamento; o botão Atualizar repete somente a leitura.
      return true;
    } catch (e) {
      if (mounted.current) setError(message(e));
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return {
    items: data?.items ?? null,
    total: data?.total ?? 0,
    page: data?.page ?? 0,
    busy: loading || saving,
    error,
    notice,
    mutate,
    reload: () => setRevision((n) => n + 1),
    clearFeedback: () => {
      setError("");
      setNotice("");
    },
  };
}
