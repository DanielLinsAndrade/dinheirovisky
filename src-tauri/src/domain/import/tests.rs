use super::*;
fn options() -> CsvOptions {
    CsvOptions {
        delimiter: ";".into(),
        decimal: ",".into(),
        date_format: "dd/MM/yyyy".into(),
        date_column: 0,
        description_column: 1,
        amount_column: 2,
        type_column: None,
        metadata_columns: BTreeMap::new(),
    }
}

#[test]
fn csv_optional_mapping_is_explicit_distinct_and_preserves_review_values() {
    let mut options = options();
    options.metadata_columns.insert("merchant".into(), 3);
    options.metadata_columns.insert("installments".into(), 4);
    let text = "Data;Descrição;Valor;Loja;Parcelas\n21/09/2026;Compra;-10,01;Loja;3/12";
    let parsed = parse_csv(text, &options).unwrap();
    assert_eq!(parsed.rows[0].metadata["merchant"], "Loja");
    assert_eq!(parsed.rows[0].metadata["installments"], "3/12");
    options.metadata_columns.insert("channel".into(), 3);
    assert!(parse_csv(text, &options).is_err());
    options.metadata_columns.remove("channel");
    options.metadata_columns.insert("unknown".into(), 5);
    assert!(parse_csv(text, &options).is_err());
    options.metadata_columns.remove("unknown");
    options.metadata_columns.insert("invoice".into(), 90);
    assert!(parse_csv(text, &options).is_err());
}
#[test]
fn csv_quotes_bom_linebreaks_delimiters_and_exact_money() {
    let p=parse_csv("\u{feff}Data;Descrição;Valor\r\n11/09/2026;\"Mercado; \"\"Centro\"\"\nLoja\";-12,34\r\n12/09/2026;Salário;90071992547409,91",&options()).unwrap();
    assert_eq!(p.rows.len(), 2);
    assert_eq!(p.rows[0].description, "Mercado; \"Centro\" Loja");
    assert_eq!(p.rows[0].date, "2026-09-11");
    assert_eq!(p.rows[0].amount, 1234);
    assert_eq!(p.rows[0].kind, "expense");
    assert_eq!(p.rows[1].amount, MAX_CENTS);
    assert_eq!(signed_cents("+1.2", ".").unwrap(), 120);
    for s in [
        "1.234,56",
        "1,234",
        "1e3",
        "NaN",
        "90071992547409,92",
        "=1+2",
    ] {
        assert!(signed_cents(s, ",").is_err());
    }
    assert!(csv_records("a;b\n\"unclosed", ";").is_err());
    assert!(csv_records("a;b\n\"x\"bad;1", ";").is_err());
    assert!(parse_csv("a;b;c\n1;2", &options()).is_err());
    assert!(csv_records(&vec!["x"; 101].join(","), ",").is_err());
    assert_eq!(parse_csv("a;b;c\n;;\n", &options()).unwrap().rows.len(), 1);
}
pub fn ofx(xml: bool) -> String {
    let leaf = |tag: &str, value: &str| {
        if xml {
            format!("<{tag}>{value}</{tag}>")
        } else {
            format!("<{tag}>{value}\n")
        }
    };
    format!("OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>{}<BANKACCTFROM>{}{}</BANKACCTFROM><BANKTRANLIST><STMTTRN>{}{}{}{}{}{}</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",leaf("CURDEF","BRL"),leaf("BANKID","001"),leaf("ACCTID","123"),leaf("TRNTYPE","DEBIT"),leaf("DTPOSTED","20260911120000[-3:BRT]"),leaf("TRNAMT","-10.50"),leaf("FITID","id-1"),leaf("NAME","Loja &amp; Cia"),leaf("MEMO","Compra"))
}
#[test]
fn ofx_xml_and_sgml_decode_values_and_reject_unsupported_documents() {
    for xml in [true, false] {
        let p = parse_ofx(&ofx(xml)).unwrap();
        assert_eq!(p.currency.as_deref(), Some("BRL"));
        assert_eq!(p.rows[0].amount, 1050);
        assert_eq!(p.rows[0].kind, "expense");
        assert_eq!(p.rows[0].description, "Loja & Cia");
        assert_eq!(p.rows[0].date, "2026-09-11");
        assert!(p.rows[0].external_id.as_ref().unwrap().contains("id-1"));
    }
    for text in [
        ofx(true).replace("</OFX>", ""),
        ofx(true).replace("</BANKTRANLIST>", ""),
        ofx(true).replace("</STMTRS>", ""),
        ofx(true).replace("<BANKTRANLIST>", ""),
        ofx(true).replace("<OFX>", "<!DOCTYPE x><OFX>"),
        ofx(true).replace("<STMTTRN>", "<STMTTRN><CORRECTFITID>x</CORRECTFITID>"),
        ofx(true).replace("<FITID>id-1</FITID>", ""),
        ofx(true).replace("</STMTRS>", "</STMTRS><STMTRS></STMTRS>"),
        ofx(true).replace("&amp;", "&unknown;"),
    ] {
        assert!(parse_ofx(&text).is_err());
    }
}
#[test]
fn limits_and_invalid_rows_are_not_silently_dropped() {
    assert!(csv_records(&"x".repeat(MAX_FILE + 1), ",").is_err());
    assert!(csv_records(&format!("a,b\n{}", "x,y\n".repeat(MAX_ROWS + 1)), ",").is_err());
    let p = parse_csv("Data;Descrição;Valor\n31/02/2026;=formula;abc", &options()).unwrap();
    assert_eq!(p.rows.len(), 1);
    assert_eq!(p.rows[0].amount, 0);
    assert_eq!(p.rows[0].raw_amount, "abc");
    assert_eq!(p.rows[0].description, "=formula");
}
use crate::domain::MAX_CENTS;
