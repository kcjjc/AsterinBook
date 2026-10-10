import { test, expect } from "@playwright/test";
test("逐页字符范围无遗漏，正文不溢出", async ({ page }) => {
  await page.goto("/test.html");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风");
  let lastEnd: number | undefined;
  const chapter = await page.getByTestId("reader-chapter").textContent();
  for (let n = 0; n < 30; n++) {
    const el = page.getByTestId("reader-view");
    const start = Number(await el.getAttribute("data-page-start")),
      end = Number(await el.getAttribute("data-page-end"));
    if (lastEnd !== undefined) expect(start).toBe(lastEnd);
    expect(end).toBeGreaterThan(start);
    expect(
      await page
        .getByTestId("page-text")
        .evaluate((e) => e.scrollHeight <= e.clientHeight + 1),
    ).toBe(true);
    if (
      await page
        .getByRole("button", { name: "下一页", exact: true })
        .isDisabled()
    )
      break;
    lastEnd = end;
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    if ((await page.getByTestId("reader-chapter").textContent()) !== chapter)
      break;
  }
});
