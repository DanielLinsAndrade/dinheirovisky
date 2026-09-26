import { expect, it } from "vitest";
import { earlierMonth, lineGeometry, validateReportPeriod } from "./reports";
it("validates ordered periods and clamps shortcuts at year one", () => {
  expect(earlierMonth("2026-02", 5)).toBe("2025-09");
  expect(earlierMonth("0001-02", 12)).toBe("0001-01");
  expect(() => validateReportPeriod("2026-01", "2035-12")).not.toThrow();
  for (const [from, to] of [
    ["2026-02", "2026-01"],
    ["2026-01", "2036-01"],
    ["0000-01", "2026-01"],
    ["2026-13", "2026-13"],
    ["", "2026-01"],
  ])
    expect(() => validateReportPeriod(from, to)).toThrow();
});
it("draws exact proportions for huge signed values and handles zero/single months", () => {
  const graph = lineGeometry([
    "-900719925474099100000",
    "0",
    "900719925474099100000",
  ]);
  expect(graph.points.map((p) => p.y)).toEqual([180, 100, 20]);
  expect(graph.zero).toBe(100);
  expect(lineGeometry(["0"]).points).toEqual([{ x: 350, y: 180 }]);
  expect(lineGeometry([]).points).toEqual([]);
  expect(lineGeometry(["5", "5"]).points.map((p) => p.y)).toEqual([20, 20]);
});
