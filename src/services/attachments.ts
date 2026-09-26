import { invoke } from "@tauri-apps/api/core";
export type AttachmentTarget = "transaction" | "purchase";
export interface Attachment {
  id: number;
  originalName: string;
  internalName: string;
  mime: string;
  size: number;
  sha256: string;
  documentType: string;
  createdAt: string;
}
export const listAttachments = (
  kind: AttachmentTarget,
  id: number,
  page: number,
) => invoke<Attachment[]>("list_attachments", { kind, id, page });
export const addAttachment = (
  kind: AttachmentTarget,
  id: number,
  documentType: string,
) => invoke<number | null>("add_attachment", { kind, id, documentType });
export const readAttachment = (id: number) =>
  invoke<{ attachment: Attachment; bytes: number[] }>("read_attachment", {
    id,
  });
export const removeAttachment = (id: number) =>
  invoke<void>("remove_attachment", { id });
