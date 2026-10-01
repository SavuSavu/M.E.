import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { readFile } from "node:fs/promises";
import { binarySTL, parseSTL } from "../../src/geometry/mesh";

for (const projection of ["orthographic", "perspective"])
  test(`visible edges can be picked in an isometric ${projection} view`, async ({
    page,
  }) => {
    await page.goto("./");
    const positions = new THREE.BoxGeometry(20, 20, 20, 4, 4, 4).toNonIndexed()
      .attributes.position.array as Float32Array;
    await page
      .getByTestId("stl-input")
      .setInputFiles({
        name: "View cube.stl",
        mimeType: "model/stl",
        buffer: Buffer.from(binarySTL(positions)),
      });
    await expect(page.locator(".body-name")).toHaveText("View cube", {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Chamfer", exact: true }).click();
    await page.getByRole("button", { name: "↗ ISO", exact: true }).click();
    if (projection === "perspective") {
      await page.getByRole("button", { name: "View", exact: true }).click();
      await page
        .getByRole("button", { name: "Orthographic", exact: true })
        .click();
    }
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    const b = (await page.locator("canvas").boundingBox())!,
      radius = Math.sqrt(3) * 10,
      half = radius * 1.25;
    const camera =
      projection === "perspective"
        ? new THREE.PerspectiveCamera(40, b.width / b.height, 0.01, 100000)
        : new THREE.OrthographicCamera(
            (-half * b.width) / b.height,
            (half * b.width) / b.height,
            half,
            -half,
            0.01,
            100000,
          );
    camera.up.set(0, 0, 1);
    camera.position
      .set(1, -1, 0.8)
      .normalize()
      .multiplyScalar(radius * 3.6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const point = new THREE.Vector3(10, -10, 0).project(camera);
    await page.mouse.click(
      b.x + ((point.x + 1) * b.width) / 2,
      b.y + ((1 - point.y) * b.height) / 2,
    );
    await expect(page.locator(".edge-selection-prompt")).toContainText(
      "1 straight edge selected",
    );
    await expect(page.locator(".edge-selection-prompt")).toContainText(
      "4 mesh segments",
    );
    await page.screenshot({
      path: `test-results/isometric-${projection}-selection.png`,
    });
    await page.getByLabel("Chamfer distance").fill("2");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".history-row").last()).toContainText(
      "Chamfer View cube",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const result = await exportGeometry(page);
    expect(result.diagnostics.openEdges).toBe(0);
    expect(result.diagnostics.volume).toBeCloseTo(7960, 0);
  });

async function exportGeometry(page: import("@playwright/test").Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const file = await downloading,
    path = await file.path(),
    bytes = await readFile(path!);
  return parseSTL(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
}

for (const segments of [1, 8])
  for (const operation of ["Chamfer", "Fillet"]) {
    test(`${operation} follows an imported cube edge through ${segments} segment(s) using viewport clicks`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("./");
      const positions = new THREE.BoxGeometry(
        20,
        20,
        20,
        segments,
        segments,
        segments,
      ).toNonIndexed().attributes.position.array as Float32Array;
      await page.getByTestId("stl-input").setInputFiles({
        name: "Edge cube.stl",
        mimeType: "model/stl",
        buffer: Buffer.from(binarySTL(positions)),
      });
      await expect(page.locator(".body-name")).toHaveText("Edge cube", {
        timeout: 30000,
      });
      await page.getByRole("button", { name: operation, exact: true }).click();
      await expect(page.getByLabel("Selection type")).toHaveValue("edge");
      await expect(page.locator(".edge-selection-prompt")).toContainText(
        "Select an edge",
      );
      await expect(
        page.getByRole("button", { name: "Apply", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "FRONT", exact: true }).click();
      await page.keyboard.press("f");
      await page.waitForTimeout(500);
      const b = (await page.locator("canvas").boundingBox())!,
        cx = b.x + b.width / 2,
        cy = b.y + b.height / 2;
      const half = b.height / (Math.sqrt(3) * 2.5);
      // Click just outside the silhouette: picking must not require a face hit.
      await page.mouse.click(cx + half * 0.3, cy - half - 4);
      await expect(page.locator(".edge-selection-prompt")).toContainText(
        "1 straight edge selected",
      );
      await expect(page.locator(".edge-selection-prompt")).toContainText(
        `${segments} mesh segment`,
      );
      await page.mouse.click(cx + half + 4, cy - half * 0.3);
      await expect(page.locator(".edge-selection-prompt")).toContainText(
        "2 straight edges selected",
      );
      await page.keyboard.down("Shift");
      await page.mouse.click(cx + half + 4, cy - half * 0.3);
      await page.keyboard.up("Shift");
      await expect(page.locator(".edge-selection-prompt")).toContainText(
        "1 straight edge selected",
      );
      await page.mouse.move(b.x + 20, b.y + 100);
      await page.screenshot({
        path: `test-results/${operation.toLowerCase()}-selection-${segments}.png`,
      });
      if (operation === "Chamfer" && segments === 8) {
        await page.getByLabel("Chamfer distance").fill("20");
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("reduce the size");
        expect((await exportGeometry(page)).diagnostics.volume).toBeCloseTo(
          8000,
          0,
        );
      }
      await page
        .getByLabel(
          operation === "Chamfer" ? "Chamfer distance" : "Blend radius",
        )
        .fill("2");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Apply preview", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      if (operation === "Chamfer" && segments === 8) {
        await page.mouse.click(cx + half + 4, cy - half * 0.3);
        await expect(
          page.getByRole("button", { name: "Apply preview", exact: true }),
        ).toHaveCount(0);
        await expect(page.locator(".edge-selection-prompt")).toContainText(
          "2 straight edges selected",
        );
        await page.keyboard.down("Shift");
        await page.mouse.click(cx + half + 4, cy - half * 0.3);
        await page.keyboard.up("Shift");
        await page
          .getByRole("button", { name: "Preview", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Apply preview", exact: true }),
        ).toBeVisible({ timeout: 30000 });
      }
      await page
        .getByRole("button", { name: "Apply preview", exact: true })
        .click();
      await expect(page.locator(".history-row").last()).toContainText(
        `${operation} Edge cube`,
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      const result = await exportGeometry(page);
      expect(result.diagnostics.openEdges).toBe(0);
      expect(result.diagnostics.nonManifoldEdges).toBe(0);
      if (operation === "Chamfer")
        expect(result.diagnostics.volume).toBeCloseTo(7960, 0);
      else {
        expect(result.diagnostics.volume).toBeGreaterThan(7980);
        expect(result.diagnostics.volume).toBeLessThan(7984);
      }
      await page.screenshot({
        path: `test-results/${operation.toLowerCase()}-result-${segments}.png`,
      });
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      expect((await exportGeometry(page)).diagnostics.volume).toBeCloseTo(
        8000,
        0,
      );
      expect(errors).toEqual([]);
    });
  }

for (const operation of ["Chamfer", "Fillet"])
  test(`adjoining mesh ${operation.toLowerCase()}s can be applied together`, async ({
    page,
  }) => {
    await page.goto("./");
    const positions = new THREE.BoxGeometry(20, 20, 20, 8, 8, 8).toNonIndexed()
      .attributes.position.array as Float32Array;
    await page.getByTestId("stl-input").setInputFiles({
      name: "Corner.stl",
      mimeType: "model/stl",
      buffer: Buffer.from(binarySTL(positions)),
    });
    await expect(page.locator(".body-name")).toHaveText("Corner", {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "FRONT", exact: true }).click();
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    const b = (await page.locator("canvas").boundingBox())!,
      cx = b.x + b.width / 2,
      cy = b.y + b.height / 2,
      half = b.height / (Math.sqrt(3) * 2.5);
    if (operation === "Chamfer") {
      await page.getByRole("button", { name: "By Curve", exact: true }).click();
      await page.mouse.click(cx, cy - half + 3);
      await expect(page.locator(".selection-summary")).toContainText(
        "8 selected entities",
      );
    }
    await page.getByRole("button", { name: operation, exact: true }).click();
    if (operation !== "Chamfer") await page.mouse.click(cx, cy - half + 3);
    await page.mouse.click(cx + half - 3, cy);
    await expect(page.locator(".edge-selection-prompt")).toContainText(
      "2 straight edges selected",
    );
    await page
      .getByLabel(operation === "Chamfer" ? "Chamfer distance" : "Blend radius")
      .fill("2");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".history-row").last()).toContainText(
      `${operation} Corner`,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const result = await exportGeometry(page);
    expect(result.diagnostics.openEdges).toBe(0);
    expect(result.diagnostics.nonManifoldEdges).toBe(0);
    if (operation === "Chamfer")
      expect(result.diagnostics.volume).toBeCloseTo(8000 - 80 + 8 / 3, 0);
    else {
      expect(result.diagnostics.volume).toBeGreaterThan(7964);
      expect(result.diagnostics.volume).toBeLessThan(7970);
    }
  });

for (const operation of ["Chamfer", "Fillet"])
  test(`all 12 cube edges blend with ${operation.toLowerCase()} using ${operation === "Chamfer" ? "an empty Exclude mask" : "connected selection"}`, async ({
    page,
  }) => {
    await page.goto("./");
    const positions = new THREE.BoxGeometry(20, 20, 20, 8, 8, 8).toNonIndexed()
      .attributes.position.array as Float32Array;
    await page.getByTestId("stl-input").setInputFiles({
      name: "All edges.stl",
      mimeType: "model/stl",
      buffer: Buffer.from(binarySTL(positions)),
    });
    await expect(page.locator(".body-name")).toHaveText("All edges", {
      timeout: 30000,
    });
    await page.getByRole("button", { name: operation, exact: true }).click();
    if (operation === "Chamfer")
      await page.getByRole("button", { name: "Exclude", exact: true }).click();
    else
      await page.getByLabel("Selection type").selectOption("connected-edges");
    await page.getByRole("button", { name: "FRONT", exact: true }).click();
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    const b = (await page.locator("canvas").boundingBox())!,
      half = b.height / (Math.sqrt(3) * 2.5);
    if (operation !== "Chamfer")
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2 - half + 3);
    await expect(page.locator(".edge-selection-prompt")).toContainText(
      "12 straight edges selected",
    );
    await page
      .getByLabel(operation === "Chamfer" ? "Chamfer distance" : "Blend radius")
      .fill("2");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".history-row").last()).toContainText(
      `${operation} All edges`,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const result = await exportGeometry(page);
    expect(result.diagnostics.openEdges).toBe(0);
    expect(result.diagnostics.nonManifoldEdges).toBe(0);
    expect(result.diagnostics.volume).toBeGreaterThan(7500);
    expect(result.diagnostics.volume).toBeLessThan(7900);
  });
