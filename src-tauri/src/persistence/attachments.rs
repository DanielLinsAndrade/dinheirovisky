use super::Database;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};
pub const MAX_FILE: usize = 10 * 1024 * 1024;
#[cfg(test)]
mod tests;
const MAX_TOTAL: i64 = 64 * 1024 * 1024;
#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub id: i64,
    pub transaction_id: Option<i64>,
    pub purchase_id: Option<i64>,
    pub document_type: String,
    pub original_name: String,
    pub internal_name: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    pub attachment: Attachment,
    pub bytes: Vec<u8>,
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn target(kind: &str, id: i64) -> Result<(Option<i64>, Option<i64>), String> {
    crate::domain::validate_id(id)?;
    match kind {
        "transaction" => Ok((Some(id), None)),
        "purchase" => Ok((None, Some(id))),
        _ => Err("Vínculo de anexo inválido.".into()),
    }
}
fn file_type(name: &str, bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    if bytes.is_empty() || bytes.len() > MAX_FILE {
        return Err("Anexo deve ter entre 1 byte e 10 MiB.".into());
    }
    super::planning::name_valid(name, 180)?;
    if name.contains(['/', '\\', ':']) || name == "." || name == ".." || name.ends_with(['.', ' '])
    {
        return Err("Nome de arquivo inválido.".into());
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 33 => {
            Ok(("image/png", "png"))
        }
        "jpg" | "jpeg" if bytes.starts_with(&[255, 216, 255]) && bytes.ends_with(&[255, 217]) => {
            Ok(("image/jpeg", "jpg"))
        }
        "webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
            Ok(("image/webp", "webp"))
        }
        "pdf"
            if bytes.starts_with(b"%PDF-")
                && bytes.windows(5).rev().take(1024).any(|w| w == b"%%EOF") =>
        {
            Ok(("application/pdf", "pdf"))
        }
        _ => Err("Tipo/conteúdo não permitido. Use PNG, JPEG, WebP ou PDF válidos.".into()),
    }
}
const COLUMNS:&str="id,transaction_id,purchase_id,document_type,original_name,internal_name,mime,size,sha256,created_at,updated_at";
fn read(r: &rusqlite::Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: r.get(0)?,
        transaction_id: r.get(1)?,
        purchase_id: r.get(2)?,
        document_type: r.get(3)?,
        original_name: r.get(4)?,
        internal_name: r.get(5)?,
        mime: r.get(6)?,
        size: r.get(7)?,
        sha256: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}
pub(super) fn manifest(c: &Connection) -> Result<Vec<Attachment>, String> {
    let count: i64 = c
        .query_row("SELECT count(*) FROM attachments", [], |r| r.get(0))
        .map_err(error)?;
    if count > 1000 {
        return Err("Quantidade de anexos excede 1000.".into());
    }
    let mut q = c
        .prepare(&format!("SELECT {COLUMNS} FROM attachments ORDER BY id"))
        .map_err(error)?;
    let rows = q
        .query_map([], read)
        .map_err(error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;
    Ok(rows)
}
pub(super) fn validate(c: &Connection) -> Result<(), String> {
    let mut total = 0;
    let entries = manifest(c)?;
    if entries.len() > 1000 {
        return Err("Quantidade de anexos excede 1000.".into());
    }
    for a in entries {
        crate::domain::validate_id(a.id)?;
        let bytes: Vec<u8> = c
            .query_row("SELECT content FROM attachments WHERE id=?1", [a.id], |r| {
                r.get(0)
            })
            .map_err(error)?;
        let (mime, ext) = file_type(&a.original_name, &bytes)?;
        if a.mime != mime
            || a.sha256 != hash(&bytes)
            || a.internal_name != format!("{}-{}.{}", a.id, a.sha256, ext)
            || a.size != bytes.len() as i64
        {
            return Err("Conteúdo ou metadados de anexo inconsistentes.".into());
        }
        total += a.size;
        if total > MAX_TOTAL {
            return Err("Anexos excedem 64 MiB nesta versão.".into());
        }
    }
    Ok(())
}
impl Database {
    pub fn attachments(&self, kind: &str, id: i64, page: i64) -> Result<Vec<Attachment>, String> {
        let (tx, purchase) = target(kind, id)?;
        if !(0..=20).contains(&page) {
            return Err("Página inválida.".into());
        }
        let mut q=self.connection.prepare(&format!("SELECT {COLUMNS} FROM attachments WHERE transaction_id IS ?1 AND purchase_id IS ?2 ORDER BY id LIMIT 50 OFFSET ?3")).map_err(error)?;
        let rows = q
            .query_map(params![tx, purchase, page * 50], read)
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        Ok(rows)
    }
    pub fn add_attachment(
        &mut self,
        kind: &str,
        id: i64,
        document_type: &str,
        path: &Path,
    ) -> Result<i64, String> {
        let metadata = std::fs::symlink_metadata(path).map_err(error)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_FILE as u64
        {
            return Err(
                "Selecione um arquivo regular de até 10 MiB; links não são aceitos.".into(),
            );
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Nome inválido.")?;
        let mut bytes = Vec::new();
        File::open(path)
            .map_err(error)?
            .take(MAX_FILE as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(error)?;
        self.store_attachment(kind, id, document_type, name, &bytes)
    }
    fn store_attachment(
        &mut self,
        kind: &str,
        id: i64,
        document_type: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<i64, String> {
        let (movement, purchase) = target(kind, id)?;
        let (mime, ext) = file_type(name, bytes)?;
        if !["proof", "receipt", "invoice", "other"].contains(&document_type) {
            return Err("Tipo de documento inválido.".into());
        }
        let digest = hash(bytes);
        let tx = self.connection.transaction().map_err(error)?;
        let duplicate:Option<i64>=tx.query_row("SELECT id FROM attachments WHERE transaction_id IS ?1 AND purchase_id IS ?2 AND sha256=?3",params![movement,purchase,digest],|r|r.get(0)).optional().map_err(error)?;
        if let Some(existing) = duplicate {
            return Ok(existing);
        }
        let (count, total): (i64, i64) = tx
            .query_row(
                "SELECT count(*),COALESCE(sum(size),0) FROM attachments",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(error)?;
        if count >= 1000 || total + bytes.len() as i64 > MAX_TOTAL {
            return Err("Limite de armazenamento: 1000 anexos ou 64 MiB.".into());
        }
        let next: i64 = tx
            .query_row("SELECT COALESCE(max(id),0)+1 FROM attachments", [], |r| {
                r.get(0)
            })
            .map_err(error)?;
        crate::domain::validate_id(next)?;
        tx.execute("INSERT INTO attachments(id,transaction_id,purchase_id,document_type,original_name,internal_name,mime,size,sha256,content) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![next,movement,purchase,document_type,name,format!("{next}-{digest}.{ext}"),mime,bytes.len() as i64,digest,bytes]).map_err(error)?;
        tx.commit().map_err(error)?;
        Ok(next)
    }
    pub fn attachment_data(&self, id: i64) -> Result<AttachmentData, String> {
        crate::domain::validate_id(id)?;
        let a = self
            .connection
            .query_row(
                &format!("SELECT {COLUMNS} FROM attachments WHERE id=?1"),
                [id],
                read,
            )
            .map_err(error)?;
        let bytes: Vec<u8> = self
            .connection
            .query_row("SELECT content FROM attachments WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(error)?;
        let (mime, ext) = file_type(&a.original_name, &bytes)?;
        if hash(&bytes) != a.sha256
            || mime != a.mime
            || a.internal_name != format!("{}-{}.{}", a.id, a.sha256, ext)
        {
            return Err("Anexo falhou na verificação de integridade.".into());
        }
        Ok(AttachmentData {
            attachment: a,
            bytes,
        })
    }
    pub fn remove_attachment(&mut self, id: i64) -> Result<(), String> {
        crate::domain::validate_id(id)?;
        if self
            .connection
            .execute("DELETE FROM attachments WHERE id=?1", [id])
            .map_err(error)?
            != 1
        {
            return Err("Anexo não encontrado.".into());
        }
        Ok(())
    }
}
