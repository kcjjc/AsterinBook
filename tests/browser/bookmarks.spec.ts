import { test, expect } from "@playwright/test";
test("书签跳转与删除，面板滚动不翻页，窄窗口不溢出", async ({ page }) => {
  await page.goto("/test.html");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风");
  await page.getByRole("button", { name: "添加或取消书签" }).click();
  await expect(
    page.getByRole("button", { name: "添加或取消书签" }),
  ).toContainText("已标记");
  await page.getByRole("button", { name: "书签列表" }).click();
  await expect(page.getByRole("button", { name: "移除书签" })).toBeVisible();
  const anchor = await page
    .getByTestId("reader-view")
    .getAttribute("data-anchor");
  await page.locator(".reading-panel").hover();
  await page.mouse.wheel(0, 800);
  expect(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
  ).toBe(anchor);
  await page.getByRole("button", { name: "移除书签" }).click();
  await expect(page.getByRole("button", { name: "移除书签" })).toHaveCount(0);
  await page.setViewportSize({ width: 475, height: 612 });
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
