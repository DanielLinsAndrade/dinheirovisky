import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSettings } from "../../app/SettingsContext";
import type { Settings } from "../../domain/settings";
export function SettingsPage() {
  const { settings, save } = useSettings();
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    // A troca global de tema não descarta as outras preferências em edição.
    setDraft((current) => ({ ...current, theme: settings.theme }));
  }, [settings.theme]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await save(draft, confirmed);
      setConfirmed(false);
      setNotice("Configurações salvas.");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Configurações da aplicação">
      <p className="intro">
        Preferências salvas neste computador e aplicadas a todas as telas.
      </p>
      <form className="settings-form" onSubmit={submit}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <fieldset disabled={busy} className="settings-groups">
          <fieldset>
            <legend>Moeda e região</legend>
            <label htmlFor="setting-currency">Moeda</label>
            <select
              id="setting-currency"
              value={draft.currency}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  currency: e.target.value as Settings["currency"],
                });
                setConfirmed(false);
              }}
            >
              <option value="BRL">Real brasileiro (BRL)</option>
              <option value="USD">Dólar americano (USD)</option>
              <option value="EUR">Euro (EUR)</option>
              <option value="GBP">Libra esterlina (GBP)</option>
            </select>
            <p className="field-help">
              Uma única moeda para todos os valores, com duas casas decimais.
              Alterar a moeda não converte saldos, transações ou orçamentos.
            </p>
            {draft.currency !== settings.currency && (
              <label className="currency-confirm">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Confirmo que os valores existentes serão interpretados na nova
                moeda, sem conversão.
              </label>
            )}
            <label htmlFor="setting-locale">Formato regional</label>
            <select
              id="setting-locale"
              value={draft.locale}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  locale: e.target.value as Settings["locale"],
                })
              }
            >
              <option value="pt-BR">Português (Brasil) — 1.234,56</option>
              <option value="en-US">Inglês (Estados Unidos) — 1,234.56</option>
              <option value="de-DE">Alemão (Alemanha) — 1.234,56</option>
            </select>
            <p className="field-help">
              Altera números e nomes dos meses. A interface permanece em
              português.
            </p>
            <label htmlFor="setting-date">Formato de data</label>
            <select
              id="setting-date"
              value={draft.dateFormat}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dateFormat: e.target.value as Settings["dateFormat"],
                })
              }
            >
              <option>dd/MM/yyyy</option>
              <option>MM/dd/yyyy</option>
              <option>yyyy-MM-dd</option>
            </select>
            <p className="field-help">
              Nos campos de calendário, o formato visual segue o sistema
              operacional.
            </p>
          </fieldset>
          <div className="settings-secondary">
            <fieldset>
              <legend>Período financeiro</legend>
              <label htmlFor="setting-start">Início do mês financeiro</label>
              <input
                id="setting-start"
                type="number"
                required
                min={1}
                max={28}
                step={1}
                value={draft.financialMonthStart}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    financialMonthStart: Number(e.target.value),
                  })
                }
              />
              <p className="field-help">
                O período começa nesse dia do mês selecionado e termina antes do
                mesmo dia do mês seguinte. Alterar recalcula Dashboard e
                utilização dos orçamentos; não altera datas ou valores.
              </p>
            </fieldset>
            <fieldset>
              <legend>Aparência</legend>
              <label htmlFor="setting-theme">Tema</label>
              <select
                id="setting-theme"
                value={draft.theme}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    theme: e.target.value as Settings["theme"],
                  })
                }
              >
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
                <option value="system">Sistema</option>
              </select>
            </fieldset>
          </div>
          <button className="action primary" type="submit">
            {busy ? "Salvando…" : "Salvar configurações"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
