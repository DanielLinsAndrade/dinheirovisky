import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Metadata, MetadataKind } from "../domain/metadata";
export { emptyDetails, methodCodes } from "../domain/metadata";
export type {
  Metadata,
  MetadataKind,
  MovementDetails,
} from "../domain/metadata";
function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri())
    return Promise.reject(
      new Error("Abra a aplicação desktop para acessar os cadastros."),
    );
  return invoke(command, args);
}
export const queryMetadata = (
  kind: MetadataKind,
  search = "",
  archived = false,
) => call<Metadata[]>("query_metadata", { kind, search, archived });
export const saveMetadata = (
  input: Omit<Metadata, "id"> & { id: number | null },
) => call<void>("save_metadata", { input });
