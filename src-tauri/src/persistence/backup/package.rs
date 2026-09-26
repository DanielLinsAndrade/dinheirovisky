use super::{err, publish, MAX_BACKUP};
use crate::persistence::attachments::{self, Attachment};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
const MAGIC: &[u8] = b"DVBACKUP2\n";
const MAX_MANIFEST: u64 = 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Manifest {
    format_version: u32,
    schema_version: usize,
    snapshot_name: String,
    snapshot_size: u64,
    snapshot_sha256: String,
    attachments: Vec<Attachment>,
}
fn digest(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(err)?;
    let mut h = Sha256::new();
    let mut block = [0; 65536];
    loop {
        let n = f.read(&mut block).map_err(err)?;
        if n == 0 {
            break;
        }
        h.update(&block[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
pub(super) fn export(c: &Connection, path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err("Escolha um nome novo. Arquivos existentes não são sobrescritos.".into());
    }
    let parent = path
        .parent()
        .filter(|p| p.is_dir())
        .ok_or("Pasta de destino inexistente.")?;
    let staging = tempfile::tempdir_in(parent).map_err(err)?;
    let snapshot = staging.path().join("snapshot.sqlite3");
    publish(c, &snapshot)?;
    let connection = Connection::open(&snapshot).map_err(err)?;
    let manifest = Manifest {
        format_version: 2,
        schema_version: super::migrations::MIGRATIONS.len(),
        snapshot_name: "snapshot.sqlite3".into(),
        snapshot_size: std::fs::metadata(&snapshot).map_err(err)?.len(),
        snapshot_sha256: digest(&snapshot)?,
        attachments: attachments::manifest(&connection)?,
    };
    drop(connection);
    let json = serde_json::to_vec(&manifest).map_err(err)?;
    if json.len() > MAX_MANIFEST as usize {
        return Err("Manifesto excede o limite.".into());
    }
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    file.write_all(MAGIC).map_err(err)?;
    file.write_all(&(json.len() as u64).to_le_bytes())
        .map_err(err)?;
    file.write_all(&json).map_err(err)?;
    std::io::copy(&mut File::open(&snapshot).map_err(err)?, &mut file).map_err(err)?;
    file.as_file().sync_all().map_err(err)?;
    file.persist_noclobber(path).map_err(err)?;
    Ok(())
}
pub(super) fn unpack(path: &Path) -> Result<Option<(tempfile::TempDir, Manifest)>, String> {
    let meta = std::fs::symlink_metadata(path).map_err(err)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("Backup deve ser um arquivo regular, não um link.".into());
    }
    let mut file = File::open(path).map_err(err)?;
    let mut header = [0; 10];
    file.read_exact(&mut header)
        .map_err(|_| "Arquivo de backup inválido.".to_string())?;
    if header != MAGIC {
        return Ok(None);
    }
    if meta.len() > MAX_BACKUP + MAX_MANIFEST + 18 {
        return Err("Pacote excede o limite.".into());
    }
    let mut length = [0; 8];
    file.read_exact(&mut length).map_err(err)?;
    let length = u64::from_le_bytes(length);
    if length == 0 || length > MAX_MANIFEST {
        return Err("Manifesto inválido.".into());
    }
    let mut json = vec![0; length as usize];
    file.read_exact(&mut json).map_err(err)?;
    let manifest: Manifest = serde_json::from_slice(&json).map_err(err)?;
    if manifest.format_version != 2
        || manifest.snapshot_name != "snapshot.sqlite3"
        || manifest.snapshot_size > MAX_BACKUP
        || manifest.snapshot_size < 100
        || manifest.attachments.len() > 1000
        || meta.len() != 18 + length + manifest.snapshot_size
    {
        return Err("Pacote incompleto ou manifesto incompatível.".into());
    }
    // Only a fixed internal path is materialized. Manifest names never become paths.
    let directory = tempfile::tempdir().map_err(err)?;
    let snapshot = directory.path().join("snapshot.sqlite3");
    let mut out = File::create(&snapshot).map_err(err)?;
    let copied = std::io::copy(&mut file.take(MAX_BACKUP + 1), &mut out).map_err(err)?;
    out.sync_all().map_err(err)?;
    drop(out);
    if copied != manifest.snapshot_size || digest(&snapshot)? != manifest.snapshot_sha256 {
        return Err("Snapshot ausente, alterado ou corrompido.".into());
    }
    Ok(Some((directory, manifest)))
}
pub(super) fn validate_manifest(
    c: &Connection,
    original_version: usize,
    m: &Manifest,
) -> Result<(), String> {
    if m.schema_version != original_version || attachments::manifest(c)? != m.attachments {
        return Err("Manifesto não corresponde ao banco e aos anexos.".into());
    }
    Ok(())
}
