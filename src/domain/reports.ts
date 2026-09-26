export function monthIndex(month: string): number {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000"))
    throw new Error("Selecione meses válidos.");
  return (Number(month.slice(0, 4)) - 1) * 12 + Number(month.slice(5)) - 1;
}
export function validateReportPeriod(from: string, to: string): void {
  const first = monthIndex(from),
    last = monthIndex(to);
  if (first > last || last - first >= 120)
    throw new Error("Selecione um intervalo ordenado de até 120 meses.");
}
export function earlierMonth(month: string, offset: number): string {
  const index = Math.max(0, monthIndex(month) - offset);
  return `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
// Conversão para Number só após reduzir a proporção: geometria, nunca dinheiro.
export function lineGeometry(values: string[]) {
  const cents = values.map(BigInt);
  const min = cents.reduce((n, v) => (v < n ? v : n), 0n),
    max = cents.reduce((n, v) => (v > n ? v : n), 0n);
  const span = max - min || 1n;
  const y = (v: bigint) => 180 - Number(((v - min) * 16000n) / span) / 100;
  return {
    min,
    max,
    zero: y(0n),
    points: cents.map((v, i) => ({
      x: cents.length === 1 ? 350 : 20 + (i * 660) / (cents.length - 1),
      y: y(v),
    })),
  };
}
