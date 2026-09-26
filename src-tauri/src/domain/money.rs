use super::MAX_CENTS;

/// Efeito efetivado de um lançamento sobre uma conta, em centavos exatos.
/// Transferências têm efeito líquido zero sobre o conjunto das duas contas.
pub fn movement_delta(
    kind: &str,
    status: &str,
    amount: i64,
    source: bool,
    destination: bool,
) -> i128 {
    if status != "posted" {
        return 0;
    }
    let mut delta = 0;
    if source {
        delta += if kind == "income" {
            i128::from(amount)
        } else {
            -i128::from(amount)
        };
    }
    if kind == "transfer" && destination {
        delta += i128::from(amount);
    }
    delta
}

pub fn signed_cents(value: &str, decimal: &str) -> Result<i64, String> {
    let value = value.trim();
    let (negative, unsigned) = if let Some(s) = value.strip_prefix('-') {
        (true, s)
    } else {
        (false, value.strip_prefix('+').unwrap_or(value))
    };
    let sep = match decimal {
        "." => '.',
        "," => ',',
        _ => return Err("Separador decimal inválido.".into()),
    };
    let parts: Vec<_> = unsigned.split(sep).collect();
    if parts.len() > 2
        || parts[0].is_empty()
        || !parts[0].bytes().all(|b| b.is_ascii_digit())
        || parts
            .get(1)
            .is_some_and(|s| s.is_empty() || s.len() > 2 || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(
            "Valor inválido: use até duas casas decimais e não use separadores de milhares.".into(),
        );
    }
    let whole = parts[0]
        .parse::<i64>()
        .map_err(|_| "Valor fora do limite.")?;
    let fraction = parts
        .get(1)
        .map_or(Ok(0), |s| {
            s.parse::<i64>()
                .map(|n| if s.len() == 1 { n * 10 } else { n })
        })
        .map_err(|_| "Valor inválido.")?;
    let cents = whole
        .checked_mul(100)
        .and_then(|n| n.checked_add(fraction))
        .filter(|n| *n <= MAX_CENTS)
        .ok_or("Valor fora do limite.")?;
    Ok(if negative { -cents } else { cents })
}

/// Decimal export without floating point, including negative extreme totals.
pub fn decimal_cents(cents: i128) -> String {
    let absolute = cents.unsigned_abs();
    format!(
        "{}{}.{:02}",
        if cents < 0 { "-" } else { "" },
        absolute / 100,
        absolute % 100
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_decimal_roundtrip_and_aggregate_extremes() {
        for value in [-MAX_CENTS, -1, 0, 1, MAX_CENTS] {
            assert_eq!(
                signed_cents(&decimal_cents(i128::from(value)), ".").unwrap(),
                value
            );
        }
        assert_eq!(
            decimal_cents(i128::MIN),
            "-1701411834604692317316873037158841057.28"
        );
        assert!(signed_cents("90071992547409.92", ".").is_err());
    }
}
