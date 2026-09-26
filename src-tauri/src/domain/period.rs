pub fn month_index(month: &str) -> Result<i32, String> {
    let bytes = month.as_bytes();
    if bytes.len() != 7
        || bytes[4] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || b.is_ascii_digit())
    {
        return Err("Informe um mês válido no formato AAAA-MM.".into());
    }
    let year = month[..4].parse::<i32>().map_err(|_| "Ano inválido.")?;
    let number = month[5..].parse::<i32>().map_err(|_| "Mês inválido.")?;
    if !(1..=9999).contains(&year) || !(1..=12).contains(&number) {
        return Err("Informe um mês válido.".into());
    }
    Ok((year - 1) * 12 + number - 1)
}
pub fn month_name(index: i32) -> String {
    format!("{:04}-{:02}", index / 12 + 1, index % 12 + 1)
}
pub fn financial_month(date: &str, start: i64) -> Option<String> {
    let index = month_index(date.get(..7)?).ok()?;
    let day = date.get(8..10)?.parse::<i64>().ok()?;
    let index = index - i32::from(day < start);
    (index >= 0).then(|| month_name(index))
}

pub fn month_bounds(month: &str, start: i64) -> Result<(String, String), String> {
    let index = month_index(month)?;
    Ok((
        format!("{month}-{start:02}"),
        if index == 119987 {
            "9999-12-32".into()
        } else {
            format!("{}-{start:02}", month_name(index + 1))
        },
    ))
}
