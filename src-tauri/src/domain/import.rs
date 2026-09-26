pub use crate::domain::money::signed_cents;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub const MAX_FILE: usize = 2_000_000;
pub const MAX_ROWS: usize = 2000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvOptions {
    pub delimiter: String,
    pub decimal: String,
    pub date_format: String,
    pub date_column: usize,
    pub description_column: usize,
    pub amount_column: usize,
    pub type_column: Option<usize>,
    #[serde(default)]
    pub metadata_columns: BTreeMap<String, usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRow {
    pub line: usize,
    pub date: String,
    pub description: String,
    pub amount: i64,
    pub kind: String,
    pub external_id: Option<String>,
    pub notes: Option<String>,
    pub raw_amount: String,
    pub metadata: BTreeMap<String, String>,
}
pub struct ParsedFile {
    pub rows: Vec<ParsedRow>,
    pub currency: Option<String>,
    pub source: String,
    pub card_statement: bool,
}
pub fn check_size(text: &str) -> Result<(), String> {
    if text.len() > MAX_FILE || text.contains('\0') {
        Err("Arquivo inválido ou maior que 2 MB após decodificação.".into())
    } else {
        Ok(())
    }
}

pub fn csv_records(text: &str, delimiter: &str) -> Result<Vec<Vec<String>>, String> {
    check_size(text)?;
    let sep = match delimiter {
        "," => ',',
        ";" => ';',
        "\t" => '\t',
        _ => return Err("Separador CSV inválido.".into()),
    };
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut closed = false;
    let mut chars = text.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        if c == '"' {
            if !field.is_empty() || closed {
                return Err("CSV com aspas fora de um campo delimitado.".into());
            }
            quoted = true;
        } else if c == sep {
            row.push(std::mem::take(&mut field));
            closed = false;
        } else if c == '\r' || c == '\n' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            row.push(std::mem::take(&mut field));
            if row.len() > 1 || !row[0].is_empty() {
                rows.push(std::mem::take(&mut row));
            } else {
                row.clear();
            }
            closed = false;
            if rows.len() > MAX_ROWS + 1 {
                return Err("Use arquivos de até 2000 lançamentos.".into());
            }
        } else {
            if closed {
                return Err("CSV contém texto após o fechamento de aspas.".into());
            }
            field.push(c);
        }
        if row.len() >= 100 {
            return Err("CSV excede 100 colunas.".into());
        }
    }
    if quoted {
        return Err("CSV com aspas sem fechamento.".into());
    }
    if !field.is_empty() || !row.is_empty() || closed {
        row.push(field);
        rows.push(row);
    }
    if rows.is_empty() || rows.len() > MAX_ROWS + 1 {
        return Err("CSV vazio ou com mais de 2000 lançamentos.".into());
    }
    Ok(rows)
}

// Não aceita agrupamento de milhares ambíguo. Decimal explicitamente escolhido.

fn civil_date(raw: &str, format: &str) -> String {
    let raw = raw.trim();
    if format == "yyyy-MM-dd" {
        return raw.into();
    }
    let parts: Vec<_> = raw.split('/').collect();
    if parts.len() != 3 {
        return raw.into();
    }
    if format == "dd/MM/yyyy" {
        format!("{}-{}-{}", parts[2], parts[1], parts[0])
    } else {
        format!("{}-{}-{}", parts[2], parts[0], parts[1])
    }
}
fn clean_text(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}
pub fn parse_csv(text: &str, options: &CsvOptions) -> Result<ParsedFile, String> {
    let records = csv_records(text, &options.delimiter)?;
    let width = records[0].len();
    if !["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"].contains(&options.date_format.as_str())
        || ![".", ","].contains(&options.decimal.as_str())
    {
        return Err("Formato CSV inválido.".into());
    }
    let mut cols = vec![
        options.date_column,
        options.description_column,
        options.amount_column,
    ];
    if let Some(c) = options.type_column {
        cols.push(c);
    }
    for (key, column) in &options.metadata_columns {
        if ![
            "method",
            "merchant",
            "intermediary",
            "channel",
            "card",
            "invoice",
            "installments",
        ]
        .contains(&key.as_str())
        {
            return Err("Coluna de metadado desconhecida.".into());
        }
        cols.push(*column);
    }
    cols.sort_unstable();
    if cols.iter().any(|c| *c >= width) || cols.windows(2).any(|w| w[0] == w[1]) {
        return Err("Selecione colunas diferentes e existentes para cada campo mapeado.".into());
    }
    let mut result = Vec::new();
    for (index, row) in records.into_iter().enumerate().skip(1) {
        if row.len() != width {
            return Err(format!(
                "Registro {} possui quantidade de colunas diferente do cabeçalho.",
                index + 1
            ));
        }
        let raw = row[options.amount_column].clone();
        let cents = signed_cents(&raw, &options.decimal).unwrap_or(0);
        let kind = if let Some(c) = options.type_column {
            match row[c].trim().to_lowercase().as_str() {
                "income" | "receita" => "income",
                "expense" | "despesa" => "expense",
                "transfer" | "transferência" | "transferencia" => "transfer",
                _ => "invalid",
            }
        } else if cents < 0 {
            "expense"
        } else {
            "income"
        };
        result.push(ParsedRow {
            line: index + 1,
            date: civil_date(&row[options.date_column], &options.date_format),
            description: clean_text(&row[options.description_column]),
            amount: cents.abs(),
            kind: kind.into(),
            external_id: None,
            notes: None,
            raw_amount: raw,
            metadata: options
                .metadata_columns
                .iter()
                .map(|(key, column)| (key.clone(), row[*column].trim().to_owned()))
                .collect(),
        });
    }
    if result.is_empty() {
        return Err("O CSV contém apenas cabeçalho, sem lançamentos.".into());
    }
    Ok(ParsedFile {
        rows: result,
        currency: None,
        source: "CSV: conta selecionada manualmente".into(),
        card_statement: false,
    })
}

fn entities(text: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some((before, after)) = rest.split_once('&') {
        out.push_str(before);
        let (entity, tail) = after
            .split_once(';')
            .ok_or("Entidade OFX sem fechamento.")?;
        let c = match entity {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            s if s.starts_with("#x") => u32::from_str_radix(&s[2..], 16)
                .ok()
                .and_then(char::from_u32)
                .ok_or("Entidade OFX inválida.")?,
            s if s.starts_with('#') => s[1..]
                .parse::<u32>()
                .ok()
                .and_then(char::from_u32)
                .ok_or("Entidade OFX inválida.")?,
            _ => return Err("Entidade OFX não suportada.".into()),
        };
        out.push(c);
        rest = tail;
    }
    out.push_str(rest);
    Ok(out)
}
// Subconjunto de extratos bancários/cartão OFX XML e SGML: não interpreta DTD,
// scripts, correções, investimentos nem conteúdo de entidades externas.
pub fn parse_ofx(text: &str) -> Result<ParsedFile, String> {
    check_size(text)?;
    let upper = text.to_ascii_uppercase();
    if upper.contains("<!")
        || upper.contains("<CORRECT")
        || upper.contains("<INVSTMT")
        || upper.contains("<STMTTRNP")
        || upper.contains("<CURRENCY>")
        || upper.contains("<ORIGCURRENCY>")
    {
        return Err("OFX com DTD, correções, investimentos, pendentes ou conversão de moeda não suportados.".into());
    }
    let start = upper
        .find("<OFX>")
        .ok_or("Arquivo não contém um documento OFX.")?;
    let mut rest = &text[start..];
    let mut fields = BTreeMap::<String, String>::new();
    let mut current: Option<BTreeMap<String, String>> = None;
    let mut records = Vec::new();
    let mut aggregates = Vec::<String>::new();
    let (mut statements, mut roots, mut root_closed) = (0, 0, false);
    let mut card_statement = false;
    while let Some((before, after)) = rest.split_once('<') {
        if !before.trim().is_empty() {
            return Err("OFX contém texto fora de um campo.".into());
        }
        let (tag, tail) = after.split_once('>').ok_or("Tag OFX sem fechamento.")?;
        let tag = tag.trim().to_ascii_uppercase();
        if !tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'/' || b == b'_')
        {
            return Err("Tag OFX com atributos ou sintaxe não suportada.".into());
        }
        if root_closed {
            return Err("Conteúdo após o fim do OFX.".into());
        }
        let end = tail.find('<').unwrap_or(tail.len());
        let value = tail[..end].trim();
        rest = &tail[end..];
        let name = tag.trim_start_matches('/');
        if ["OFX", "STMTRS", "CCSTMTRS", "BANKTRANLIST", "STMTTRN"].contains(&name) {
            if tag.starts_with('/') {
                if aggregates.pop().as_deref() != Some(name) {
                    return Err("Estrutura OFX incompleta ou fora de ordem.".into());
                }
            } else {
                let parent = aggregates.last().map(String::as_str);
                let valid = match name {
                    "OFX" => parent.is_none(),
                    "STMTRS" | "CCSTMTRS" => parent == Some("OFX"),
                    "BANKTRANLIST" => matches!(parent, Some("STMTRS" | "CCSTMTRS")),
                    "STMTTRN" => parent == Some("BANKTRANLIST"),
                    _ => false,
                };
                if !valid || !value.is_empty() {
                    return Err("Estrutura OFX inválida.".into());
                }
                aggregates.push(name.to_owned());
            }
        }
        match tag.as_str() {
            "OFX" => {
                roots += 1;
            }
            "/OFX" => {
                root_closed = true;
            }
            "STMTRS" | "CCSTMTRS" => {
                statements += 1;
                card_statement = tag == "CCSTMTRS";
            }
            "STMTTRN" => {
                if current.is_some() {
                    return Err("STMTTRN sem fechamento.".into());
                }
                current = Some(BTreeMap::new());
            }
            "/STMTTRN" => {
                records.push(current.take().ok_or("Fechamento STMTTRN inesperado.")?);
                if records.len() > MAX_ROWS {
                    return Err("Use arquivos de até 2000 lançamentos.".into());
                }
            }
            _ => {}
        }
        if !value.is_empty() {
            if tag.starts_with('/') {
                return Err("Texto após fechamento de tag OFX.".into());
            }
            let value = entities(value)?;
            let map = current.as_mut().unwrap_or(&mut fields);
            if map.insert(tag.clone(), value).is_some()
                && [
                    "DTPOSTED", "TRNAMT", "FITID", "CURDEF", "ACCTID", "BANKID", "TRNTYPE", "NAME",
                    "MEMO",
                ]
                .contains(&tag.as_str())
            {
                return Err(format!("Campo OFX duplicado: {tag}."));
            }
        }
    }
    if roots != 1
        || !root_closed
        || !aggregates.is_empty()
        || current.is_some()
        || statements != 1
        || records.is_empty()
    {
        return Err("OFX incompleto ou contém múltiplos extratos. Use um extrato bancário/cartão por arquivo.".into());
    }
    let currency = fields
        .get("CURDEF")
        .ok_or("OFX sem moeda CURDEF.")?
        .trim()
        .to_ascii_uppercase();
    let account = fields
        .get("ACCTID")
        .ok_or("OFX sem identificação ACCTID.")?;
    let bank = fields
        .get("BANKID")
        .or(fields.get("ORG"))
        .map(String::as_str)
        .unwrap_or("");
    let source = format!("OFX — instituição {bank}, conta {account}");
    let mut rows = Vec::new();
    for (index, record) in records.into_iter().enumerate() {
        let get = |key: &str| record.get(key).map(String::as_str).unwrap_or("");
        let posted = get("DTPOSTED");
        let date = if posted.len() >= 8 && posted.as_bytes()[..8].iter().all(u8::is_ascii_digit) {
            format!("{}-{}-{}", &posted[..4], &posted[4..6], &posted[6..8])
        } else {
            posted.into()
        };
        let raw = get("TRNAMT");
        let cents = signed_cents(raw, ".").unwrap_or(0);
        let kind = if get("TRNTYPE") == "XFER" {
            "transfer"
        } else if cents < 0 {
            "expense"
        } else {
            "income"
        };
        let fitid = get("FITID");
        if fitid.is_empty() || fitid.len() > 255 {
            return Err("OFX contém lançamento sem FITID válido.".into());
        }
        let external_id = serde_json::to_string(&(bank, account, fields.get("ACCTTYPE"), fitid))
            .map_err(|e| e.to_string())?;
        rows.push(ParsedRow {
            line: index + 1,
            date,
            description: clean_text(if get("NAME").is_empty() {
                get("MEMO")
            } else {
                get("NAME")
            }),
            amount: cents.abs(),
            kind: kind.into(),
            external_id: Some(external_id),
            notes: (!get("MEMO").is_empty()).then(|| get("MEMO").to_owned()),
            raw_amount: raw.into(),
            metadata: BTreeMap::new(),
        });
    }
    Ok(ParsedFile {
        rows,
        currency: Some(currency),
        source,
        card_statement,
    })
}

#[cfg(test)]
mod tests;
