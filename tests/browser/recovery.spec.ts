import { test, expect } from "@playwright/test";
test("设置写入失败后返回书架会重试最新设置", async ({ page }) => {
  await page.goto("/test.html?scenario=prefs-failure");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风");
  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByLabel("字号").fill("24");
  await expect(page.getByRole("status")).toContainText("设置未保存");
  await page.waitForTimeout(5100);
  await expect(
    page.getByRole("button", { name: "重试保存设置", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← 书架" }).click();
  await expect(
    page.getByRole("button", { name: "阅读测试小说甲", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await page.getByRole("button", { name: "阅读设置" }).click();
  await expect(page.getByLabel("字号")).toHaveValue("24");
});
test("启动异常提供重试入口", async ({ page }) => {
  await page.goto("/test.html?scenario=startup-failure");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "阅读测试小说甲", exact: true }),
  ).toBeVisible();
});
test("第二块失败只重传未确认块，正文没有重复", async ({ page }) => {
  await page.goto("/test.html?import&scenario=chunk-failure");
  await page.getByRole("button", { name: "导入 TXT" }).click();
  await expect(page.getByRole("button", { name: "确认导入" })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByRole("alert")).toContainText("第二块写入失败");
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(
    page.getByRole("button", { name: "阅读新导入小说", exact: true }),
  ).toBeVisible();
});
test("长章续读不会暴露锚点之前的临时页面", async ({ page }) => {
  await page.goto("/test.html?scenario=deep");
  await page.evaluate(() => {
    (window as any).badPrefix = false;
    new MutationObserver(() => {
      const reader = document.querySelector<HTMLElement>(
        '[data-testid="reader-view"]',
      );
      if (reader?.dataset.pageEnd && Number(reader.dataset.pageEnd) < 90000)
        (window as any).badPrefix = true;
    }).observe(document.body, {
      attributes: true,
      subtree: true,
      childList: true,
    });
  });
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        Number(
          await page.getByTestId("reader-view").getAttribute("data-page-end"),
        ),
      { timeout: 25000 },
    )
    .toBeGreaterThan(90000);
  expect(await page.evaluate(() => (window as any).badPrefix)).toBe(false);
  await expect(page.getByTestId("reader-view")).toHaveAttribute(
    "data-anchor",
    "90000",
  );
});
test("排版面板的按钮方向键不会翻页", async ({ page }) => {
  await page.goto("/test.html");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风");
  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: "暖纸", exact: true }).focus();
  const anchor = await page
    .getByTestId("reader-view")
    .getAttribute("data-anchor");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("reader-view")).toHaveAttribute(
    "data-anchor",
    anchor!,
  );
});
