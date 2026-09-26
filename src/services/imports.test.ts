import { expect, it, vi } from "vitest";
import { readImportFile } from "./imports";
it("bounds files before reading and requires explicit valid decoding", async () => {
  const arrayBuffer = vi.fn();
  await expect(
    readImportFile(
      { size: 2_000_001, arrayBuffer } as unknown as File,
      "utf-8",
    ),
  ).rejects.toThrow(/2 MB/);
  expect(arrayBuffer).not.toHaveBeenCalled();
  const file = {
    size: 1,
    arrayBuffer: async () => new Uint8Array([0xe9]).buffer,
  } as File;
  await expect(readImportFile(file, "utf-8")).rejects.toThrow(/codificação/);
  await expect(readImportFile(file, "windows-1252")).resolves.toBe("é");
});
