import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { WindowTitleBar } from "../app/WindowTitleBar";

export function Editor({
  title,
  busy,
  error,
  onClose,
  children,
  modal = true,
  className = "",
  dismissOnBackdrop = false,
}: {
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  children: ReactNode;
  modal?: boolean;
  className?: string;
  dismissOnBackdrop?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const titleId = useId();
  const backdropPress = useRef(false);
  const current = useRef({ busy, onClose });
  current.current = { busy, onClose };
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = opener.current;
    if (modal) element.showModal();
    else {
      element.setAttribute("open", "");
      (
        element.querySelector<HTMLElement>(
          "[autofocus], input, select, textarea",
        ) ?? element.querySelector<HTMLElement>("button")
      )?.focus();
    }
    const escape = (event: KeyboardEvent) => {
      if (
        !modal &&
        event.key === "Escape" &&
        !document.querySelector('dialog[open][aria-modal="true"]')
      ) {
        event.preventDefault();
        if (!current.current.busy) current.current.onClose();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      const restore = element.contains(document.activeElement);
      if (modal) element.close();
      else element.removeAttribute("open");
      if (restore)
        queueMicrotask(() => {
          // O acionador pode ser reabilitado no mesmo commit que fecha o editor.
          // Não roubar foco de uma navegação ou de outro diálogo recém-aberto.
          if (previous?.isConnected && document.activeElement === document.body)
            previous.focus();
        });
    };
  }, [modal]);
  return (
    <dialog
      ref={dialog}
      className={`editor ${className}`}
      aria-labelledby={titleId}
      aria-modal={modal}
      onPointerDown={(event) => {
        backdropPress.current = false;
        if (
          !dismissOnBackdrop ||
          !modal ||
          busy ||
          event.target !== event.currentTarget
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        backdropPress.current =
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={(event) => {
        if (!dismissOnBackdrop || !modal || busy || !backdropPress.current)
          return;
        backdropPress.current = false;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside =
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom);
        if (outside) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="editor-header">
        <h2 id={titleId}>{title}</h2>
        <Button
          type="button"
          className="action"
          disabled={busy}
          onClick={onClose}
        >
          Fechar
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {children}
      {modal && <WindowTitleBar />}
    </dialog>
  );
}
