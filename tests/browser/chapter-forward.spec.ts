import { test, expect, type Page } from "@playwright/test";
async function open(page: Page, scenario = "chapter-boundary") {
  await page.goto(`/test.html?scenario=${scenario}`);
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("page-text")).toContainText("山风");
  await expect(page.locator(".footer-buttons")).not.toContainText("排版中");
}
test("短章节重排后页范围不变，正文仍然显示", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "阅读设置", exact: true }).click();
  await page.getByLabel("字号").fill("21");
  await expect(page.getByTestId("page-text")).toContainText("山风吹过");
});
for (const way of ["ArrowRight", "ArrowDown", "edge", "wheel", "button"]) {
  test(`章末 ${way} 进入下一章首页并保存续读`, async ({ page }) => {
    await open(page);
    const body = page.getByTestId("page-text");
    if (way === "edge") {
      const r = (await body.boundingBox())!;
      await page.mouse.click(r.x + r.width - 10, r.y + r.height / 2);
    } else if (way === "wheel") {
      await body.hover();
      await page.mouse.wheel(0, 80);
    } else if (way === "button") {
      await expect(
        page.getByRole("button", { name: "下一页", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
    } else await page.keyboard.press(way);
    await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
    await expect(body).toContainText("归途灯火");
    await expect(page.getByTestId("reader-view")).toHaveAttribute(
      "data-anchor",
      "20",
    );
    await page.getByRole("button", { name: "← 书架" }).click();
    await page
      .getByRole("button", { name: "阅读测试小说甲", exact: true })
      .click();
    await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
  });
}
test("快速连续触发章末翻页不会在保存期间跳过下一章", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
});

test("进度保存尚未完成时，再次翻页仍只进入下一章", async ({ page }) => {
  await open(page, "chapter-save-delay");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  await expect(page.getByTestId("reader-chapter")).toContainText("第一章");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-text")).toContainText("归途灯火");
  await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
});

test("章末保存失败保留当前章，重试后进入下一章", async ({ page }) => {
  await open(page, "chapter-save-failure");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status")).toContainText("模拟进度保存失败");
  await expect(page.getByTestId("reader-chapter")).toContainText("第一章");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-text")).toContainText("归途灯火");
  await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
});

test("后续正文读取失败时，临时末页不会跳过未读内容进入下一章", async ({
  page,
}) => {
  await page.goto("/test.html?scenario=failed-pagination");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("模拟后续正文读取失败");
  const total = Number(
    (await page.locator(".footer-buttons span").innerText()).split("/")[1],
  );
  expect(total).toBeGreaterThan(1);
  for (let n = 1; n < total; n++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("reader-chapter")).toContainText("第一章");
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
});
test("全书末页停止，反向翻页仍停在本章首页", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("reader-chapter")).toContainText("第一章");
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.getByTestId("page-text")).toContainText("归途");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("reader-chapter")).toContainText("第二章");
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.getByTestId("page-text")).toContainText("故事结束");
  const anchor = await page
    .getByTestId("reader-view")
    .getAttribute("data-anchor");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status")).toContainText("已到全书末页");
  await expect(page.getByTestId("reader-view")).toHaveAttribute(
    "data-anchor",
    anchor!,
  );
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
});
test("长章排版中的临时最后一页不会提前跨章", async ({ page }) => {
  await page.goto("/test.html?scenario=slow-pagination");
  await page
    .getByRole("button", { name: "阅读测试小说甲", exact: true })
    .click();
  await expect(page.getByTestId("reader-view")).toHaveAttribute(
    "data-page-end",
    /\d+/,
  );
  const next = page.getByRole("button", { name: "下一页", exact: true });
  for (let n = 0; n < 400 && (await next.isEnabled()); n++)
    await page.keyboard.press("ArrowRight");
  await expect(page.locator(".footer-buttons")).toContainText("排版中");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("reader-chapter")).toContainText("第一章");
});
