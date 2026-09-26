use super::period::{month_index, month_name};
use serde::Serialize;
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CardDates {
    pub month: String,
    pub closing_date: String,
    pub due_date: String,
}
fn day_in_month(index: i32, day: i64) -> Result<String, String> {
    if !(0..=119987).contains(&index) || !(1..=31).contains(&day) {
        return Err("Calendário fora do intervalo suportado.".into());
    }
    let year = index / 12 + 1;
    let month = index % 12 + 1;
    let days = match month {
        2 => {
            if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    Ok(format!("{}-{:02}", month_name(index), day.min(days)))
}
pub fn cycle(index: i32, closing: i64, due: i64) -> Result<CardDates, String> {
    let closing_date = day_in_month(index, closing)?;
    let same = day_in_month(index, due)?;
    let due_date = if same > closing_date {
        same
    } else {
        day_in_month(index + 1, due)?
    };
    Ok(CardDates {
        month: month_name(index),
        closing_date,
        due_date,
    })
}
pub fn split(amount: i64, count: i64) -> Result<Vec<i64>, String> {
    if !(1..=crate::domain::MAX_CENTS).contains(&amount)
        || !(1..=120).contains(&count)
        || count > amount
    {
        return Err(
            "Informe valor positivo e de 1 a 120 parcelas, sem parcelas de zero centavos.".into(),
        );
    }
    Ok((0..count)
        .map(|i| amount / count + i64::from(i < amount % count))
        .collect())
}
pub fn calendar(month: &str, closing: i64, due: i64) -> Result<Vec<CardDates>, String> {
    let first = month_index(month)?;
    if !(1..=31).contains(&closing) || !(1..=31).contains(&due) {
        return Err("Os dias devem estar entre 1 e 31.".into());
    }
    (first..first + 12)
        .map(|index| cycle(index, closing, due))
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clamps_short_months_and_keeps_due_after_closing() {
        let rows = calendar("2024-01", 31, 30).unwrap();
        assert_eq!(rows[0].closing_date, "2024-01-31");
        assert_eq!(rows[0].due_date, "2024-02-29");
        assert_eq!(rows[1].closing_date, "2024-02-29");
        assert_eq!(rows[1].due_date, "2024-03-30");
        assert_eq!(
            calendar("2100-02", 31, 31).unwrap()[0].closing_date,
            "2100-02-28"
        );
        assert_eq!(
            calendar("2000-02", 31, 31).unwrap()[0].closing_date,
            "2000-02-29"
        );
        assert_eq!(
            calendar("2026-12", 5, 10).unwrap()[0].due_date,
            "2026-12-10"
        );
        assert_eq!(
            calendar("2026-12", 10, 5).unwrap()[0].due_date,
            "2027-01-05"
        );
        assert!(calendar("9999-12", 31, 1).is_err());
        assert!(calendar("0000-01", 5, 10).is_err());
        assert!(calendar("2026-01", 0, 32).is_err());
    }
}
