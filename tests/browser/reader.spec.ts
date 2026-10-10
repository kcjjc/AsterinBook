import { test, expect } from "@playwright/test";
test("正文点击边缘、滚轮上下与方向键都按单页切换", async ({ page }) => {
  await page.goto("/test.html");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风");
  const reader = page.getByTestId("reader-view"),
    body = page.getByTestId("page-text");
  const first = await reader.getAttribute("data-anchor");
  await body.hover();
  await page.mouse.wheel(0, 80);
  await expect
    .poll(async () => await reader.getAttribute("data-anchor"))
    .not.toBe(first);
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, -80);
  await expect(reader).toHaveAttribute("data-anchor", first!);
  const box = (await body.boundingBox())!;
  await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2);
  await expect
    .poll(async () => await reader.getAttribute("data-anchor"))
    .not.toBe(first);
  await page.keyboard.press("ArrowUp");
  await expect(reader).toHaveAttribute("data-anchor", first!);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect(reader).toHaveAttribute("data-anchor", first!);
});
test("书架进入整窗阅读，调字号保持锚点", async ({ page }) => {
  await page.goto("/test.html");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("reader-view")).toBeVisible();
  await expect(page.getByTestId("library-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("page-text")).toContainText("山风");
  const bounds = await page.getByTestId("reader-view").boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(1280);
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
  await page.getByRole("button", { name: "阅读设置", exact: true }).click();
  const anchor = await page
    .getByTestId("reader-view")
    .getAttribute("data-anchor");
  await page.getByLabel("字号").focus();
  for (let n = 0; n < 8; n++) await page.keyboard.press("ArrowRight");
  await page.setViewportSize({ width: 700, height: 650 });
  await page.waitForTimeout(350);
  expect(
    await page.getByTestId("reader-view").getAttribute("data-anchor"),
  ).toBe(anchor);
  expect(
    await page
      .getByTestId("page-text")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
});
