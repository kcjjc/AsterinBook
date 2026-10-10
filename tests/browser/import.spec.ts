import { test, expect } from "@playwright/test";
test("导入提交失败后可重试，不重复上传已完成正文", async ({ page }) => {
  await page.goto("/test.html?import");
  await page.getByRole("button", { name: "＋ 导入 TXT" }).click();
  await expect(page.getByRole("dialog", { name: "导入小说" })).toContainText(
    "识别 2 个章节",
  );
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟数据库提交失败");
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(
    page.getByRole("button", { name: "阅读新导入小说", exact: true }),
  ).toBeVisible();
});
