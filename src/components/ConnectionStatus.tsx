export type Connection =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

export function ConnectionStatus({ connection }: { connection: Connection }) {
  return (
    <p className={`connection ${connection.state}`} role="status">
      <span aria-hidden="true" className="status-dot" />
      {connection.state === "loading" && "Verificando armazenamento local…"}
      {connection.state === "ready" && "Armazenamento local conectado"}
      {connection.state === "error" && "Armazenamento indisponível"}
    </p>
  );
}
