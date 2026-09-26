import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../../components/Button";

GlobalWorkerOptions.workerSrc = workerUrl;
const assets = import.meta.glob<string>(
  [
    "/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*",
    "!/node_modules/pdfjs-dist/wasm/quickjs*",
  ],
  { eager: true, query: "?url&no-inline", import: "default" },
);
class LocalPdfAssets {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory = {
      cMapUrl: "cmaps",
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
    }[kind];
    const url =
      directory && assets[`/node_modules/pdfjs-dist/${directory}/${filename}`];
    if (!url) throw new Error("Recurso local do PDF indisponível.");
    const response = await fetch(url);
    if (!response.ok)
      throw new Error("Falha ao carregar recurso local do PDF.");
    return new Uint8Array(await response.arrayBuffer());
  }
}
export default function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setDocument(null);
    setPage(1);
    setError("");
    setLoading(true);
    const task = getDocument({
      data: bytes.slice(),
      enableXfa: false,
      useWorkerFetch: false,
      BinaryDataFactory: LocalPdfAssets,
      disableFontFace: true,
      maxImageSize: 16_000_000,
      canvasMaxAreaInBytes: 24_000_000,
      stopAtErrors: true,
    });
    task.onPassword = () => {
      if (active) {
        setError(
          "Este PDF exige senha. A visualização de documentos protegidos não está disponível; o anexo foi preservado.",
        );
        setLoading(false);
      }
      void task.destroy();
    };
    task.promise.then(
      (doc) => {
        if (active) setDocument(doc);
      },
      (e) => {
        if (active) {
          setError(`Não foi possível abrir este PDF: ${String(e)}`);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (!document) return;
    let active = true;
    let rendering:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setLoading(true);
    setError("");
    setText("");
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (!active || !canvas.current) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          1400 / natural.width,
          Math.sqrt(6_000_000 / (natural.width * natural.height)),
        );
        const viewport = pdfPage.getViewport({ scale });
        canvas.current.width = Math.ceil(viewport.width);
        canvas.current.height = Math.ceil(viewport.height);
        rendering = pdfPage.render({ canvas: canvas.current, viewport });
        await rendering.promise;
        const content = await pdfPage.getTextContent();
        if (active)
          setText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
      } catch (e) {
        if (active)
          setError(`Não foi possível renderizar esta página: ${String(e)}`);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      rendering?.cancel();
    };
  }, [document, page]);
  return (
    <div>
      {loading && <p role="status">Carregando PDF…</p>}
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        className="attachment-preview"
        role="img"
        aria-label={`Página ${page} do PDF`}
        hidden={loading || !!error}
      />
      {document && (
        <div className="list-tools">
          <Button
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Página anterior do PDF
          </Button>
          <span role="status">
            Página {page} de {document.numPages}
          </span>
          <Button
            disabled={loading || page >= document.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima página do PDF
          </Button>
        </div>
      )}
      {!loading && !error && (
        <details>
          <summary>Texto extraído da página</summary>
          <p>
            {text ||
              "Esta página contém apenas imagem ou não possui texto extraível."}
          </p>
        </details>
      )}
    </div>
  );
}
