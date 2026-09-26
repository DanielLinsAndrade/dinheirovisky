// Check the persisted theme after its React effect and finite CSS transitions.
// Measuring interpolated colors can mix the old text with the new surface.
module.exports = async (page, theme) => {
  await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
  await page.waitForFunction((theme) => {
    const select = document.querySelector('select[aria-label="Aparência"]');
    const resolved = theme === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    return select && !select.disabled && select.value === theme && document.documentElement.dataset.theme === resolved;
  }, theme);
  await page.evaluate(async () => {
    // Flush the style change before inspecting CSS transition animations.
    getComputedStyle(document.body).backgroundColor;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
};
