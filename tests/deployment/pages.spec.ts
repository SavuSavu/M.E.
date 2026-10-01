import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { binarySTL } from "../../src/geometry/mesh";

test("published assets, geometry workers and both WASM kernels work under the Pages path", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [],
    failures: string[] = [],
    assetURLs: string[] = [];
  const root = new URL(baseURL!);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/\.(js|css|wasm|woff2?)(\?|$)/.test(url.pathname))
      assetURLs.push(url.href);
  });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "A workspace for your next idea." }),
  ).toBeVisible();
  const bytes = binarySTL(
    new THREE.BoxGeometry(20, 20, 20).toNonIndexed().attributes.position
      .array as Float32Array,
  );
  await page
    .getByTestId("stl-input")
    .setInputFiles({
      name: "Pages smoke.stl",
      mimeType: "model/stl",
      buffer: Buffer.from(bytes),
    });
  await expect(page.locator(".body-name")).toHaveText("Pages smoke", {
    timeout: 30000,
  });
  await page.getByLabel("Selection type").selectOption("planar");
  await page.keyboard.press("f");
  const canvas = page.locator("canvas"),
    box = (await canvas.boundingBox())!;
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".selection-summary")).toContainText(
    "2 selected entities",
  );
  await page.getByRole("button", { name: "Offset", exact: true }).click();
  await page.getByLabel("Offset distance").fill("2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".history-row").last()).toContainText(
    "Offset Pages smoke",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add solid", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".body-row")).toHaveCount(2, { timeout: 90000 });
  await expect(page.locator(".body-name").last()).toHaveText("Cube");
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const project = await save;
  expect(project.suggestedFilename()).toMatch(/\.meproj$/);
  const path = await project.path();
  await page.reload();
  await page.getByTestId("project-input").setInputFiles(path!);
  await expect(page.locator(".body-row")).toHaveCount(2, { timeout: 30000 });
  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  expect((await exportDownload).suggestedFilename()).toMatch(/\.stl$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(
    assetURLs.some((url) => url.endsWith(".wasm") && url.includes("manifold")),
  ).toBe(true);
  expect(
    assetURLs.some(
      (url) => url.endsWith(".wasm") && url.includes("opencascade"),
    ),
  ).toBe(true);
  for (const url of assetURLs) {
    expect(new URL(url).origin).toBe(root.origin);
    expect(new URL(url).pathname.startsWith(root.pathname)).toBe(true);
  }
  await page.screenshot({
    path: "test-results/pages-production.png",
    fullPage: true,
  });
});
