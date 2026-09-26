import { useEffect, useRef, useState } from "react";

export function useCatalog<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    load()
      .then(
        (rows) => {
          if (current) setItems(rows);
        },
        (reason: unknown) => {
          if (current)
            setError(reason instanceof Error ? reason.message : String(reason));
        },
      )
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [load, revision]);

  async function mutate(
    operation: () => Promise<T[]>,
    message: string,
  ): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const rows = await operation();
      if (!mounted.current) return false;
      setItems(rows);
      setNotice(message);
      return true;
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    items,
    busy,
    error,
    notice,
    mutate,
    clearFeedback: () => {
      setError("");
      setNotice("");
    },
    reload: () => setRevision((value) => value + 1),
  };
}
