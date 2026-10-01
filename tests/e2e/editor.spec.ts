import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { binarySTL } from "../../src/geometry/mesh";
const cubeFile = () =>
  Buffer.from(
    binarySTL(
      new THREE.BoxGeometry(20, 20, 20).toNonIndexed().attributes.position
        .array as Float32Array,
    ),
  );
test("brush masks retain partial triangles across mode changes and block face offset", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("stl-input").setInputFiles({
    name: "Painted.stl",
    mimeType: "model/stl",
    buffer: cubeFile(),
  });
  await expect(page.locator(".body-row")).toHaveCount(1);
  const before = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      paintPath = "/src/geometry/paint.ts";
    const { useEditor } = await import(statePath),
      { paintRegion } = await import(paintPath);
    const s = useEditor.getState(),
      body = s.bodies[0],
      g = s.geometries[body.geometryId];
    const p = g.centroids,
      n = g.faceNormals;
    const data = paintRegion(g, {
      samples: [
        {
          face: 0,
          from: { x: p[0], y: p[1], z: p[2] },
          to: { x: p[0], y: p[1], z: p[2] },
          view: { x: -n[0], y: -n[1], z: -n[2] },
        },
      ],
      radius: 2,
      mode: "include",
    });
    s.commit("Brush selection", "selection", {}, s.bodies, [], {
      ...s.selection,
      refs: [{ bodyId: body.id, revision: g.id, kind: "brush", ids: data.ids }],
      paint: { bodyId: body.id, revision: g.id, data },
    });
    return { count: data.count, overlay: data.overlay.length };
  });
  await page.getByRole("button", { name: "Exclude", exact: true }).click();
  await expect(page.locator(".job-progress")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Exclude", exact: true }),
  ).toHaveClass(/mask-active/);
  const after = await page.evaluate(async () => {
    const path = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(path),
      { prepareOperation } = await import(opPath);
    const data = useEditor.getState().selection.paint!.data as any;
    const result = await prepareOperation("offset", { amount: 2 });
    return {
      count: data.count,
      overlay: data.overlay.length,
      blocked: result === undefined,
    };
  });
  expect(after.count).toBe(before.count);
  expect(after.overlay).toBeGreaterThan(before.overlay);
  expect(after.blocked).toBe(true);
  await expect(page.getByRole("alert")).toContainText(
    "complete planar surface",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Include Only", exact: true }),
  ).toHaveClass(/mask-active/);
});
test("imports, selects planar triangles, commits transforms, exports and undoes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("stl-input").setInputFiles({
    name: "Bracket.stl",
    mimeType: "model/stl",
    buffer: cubeFile(),
  });
  await expect(page.locator(".body-name")).toHaveText("Bracket", {
    timeout: 20000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("12 triangles");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await page.getByLabel("X", { exact: true }).fill("45");
  await page.getByRole("button", { name: "Apply transform" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("Bracket.stl");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("0");
  await page.getByLabel("Selection type").selectOption("planar");
  const canvas = page.locator("canvas"),
    box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".selection-summary")).toContainText(
    "2 selected entities",
  );
  await page.screenshot({ path: "test-results/editor-mesh.png" });
});
test("native solids run in the worker, Boolean result is valid, and projects round-trip", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add solid", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".body-name")).toHaveText("Cube", {
    timeout: 60000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(async () => {
    const path = "/src/state/operations.ts";
    const { execute } = await import(path);
    await execute("primitive", { shape: "cylinder", radius: 7, height: 40 });
  });
  await expect(page.locator(".body-row")).toHaveCount(2);
  await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath),
      s = useEditor.getState();
    await execute(
      "subtract",
      {},
      s.bodies.map((b: any) => b.id),
    );
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  const data = await page.evaluate(async () => {
    const path = "/src/state/editor.ts";
    const { useEditor } = await import(path),
      s = useEditor.getState(),
      g = s.geometries[s.bodies[0].geometryId];
    return {
      kind: g.kind,
      triangles: g.diagnostics.triangles,
      volume: g.diagnostics.volume,
      brep: !!g.brep,
    };
  });
  expect(data.kind).toBe("brep");
  expect(data.brep).toBe(true);
  expect(data.volume).toBeLessThan(27000);
  expect(data.volume).toBeGreaterThan(22000);
  await page.evaluate(async () => {
    const path = "/src/state/project.ts",
      statePath = "/src/state/editor.ts";
    const { projectBytes, decodeProject } = await import(path),
      { useEditor } = await import(statePath),
      s = useEditor.getState(),
      decoded = await decodeProject(await projectBytes());
    if (
      decoded.bodies.length !== s.bodies.length ||
      decoded.history.length !== s.history.length ||
      !decoded.geometries[decoded.bodies[0].geometryId].brep
    )
      throw new Error("Project did not preserve topology/history");
  });
  await page.screenshot({ path: "test-results/editor-native.png" });
});
test("mesh booleans reject open surfaces without modifying the target", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("stl-input").setInputFiles([
    { name: "Target.stl", mimeType: "model/stl", buffer: cubeFile() },
    { name: "Cutter.stl", mimeType: "model/stl", buffer: cubeFile() },
  ]);
  await expect(page.locator(".body-row")).toHaveCount(2);
  await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath),
      s = useEditor.getState(),
      tool = s.bodies[1];
    s.updateBody(
      tool.id,
      { transform: { ...tool.transform, position: [10, 0, 0] } },
      "Move cutter",
      "transform",
    );
    await execute(
      "subtract",
      {},
      s.bodies.map((b: any) => b.id),
    );
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  const volume = await page.evaluate(async () => {
    const path = "/src/state/editor.ts";
    const { useEditor } = await import(path),
      s = useEditor.getState();
    return s.geometries[s.bodies[0].geometryId].diagnostics.volume;
  });
  expect(volume).toBeCloseTo(4000);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const positions = new THREE.BoxGeometry(20, 20, 20).toNonIndexed().attributes
    .position.array as Float32Array;
  await page.getByTestId("stl-input").setInputFiles({
    name: "Open.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(binarySTL(positions.slice(9))),
  });
  await expect(page.locator(".body-row")).toHaveCount(3);
  await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath),
      s = useEditor.getState();
    await execute("union", {}, [s.bodies[0].id, s.bodies[2].id]);
  });
  await expect(page.getByRole("alert")).toContainText("closed");
});
test("native fillet, chamfer, planar offset and plane split retain CAD topology", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath);
    await execute("primitive", {
      shape: "cube",
      width: 30,
      depth: 30,
      height: 30,
    });
    const s = useEditor.getState(),
      body = s.bodies[0],
      g = s.geometries[body.geometryId];
    if (s.error) throw new Error(s.error);
    s.selectEntities(body.id, [0], "edge");
    await execute("fillet", { amount: 2 });
    if (useEditor.getState().error) throw new Error(useEditor.getState().error);
    const fillet =
      useEditor.getState().geometries[
        useEditor.getState().bodies[0].geometryId
      ];
    s.undo();
    s.selectEntities(body.id, [0], "edge");
    await execute("chamfer", { amount: 2 });
    if (useEditor.getState().error) throw new Error(useEditor.getState().error);
    const chamfer =
      useEditor.getState().geometries[
        useEditor.getState().bodies[0].geometryId
      ];
    s.undo();
    const faces = Array.from(g.faceIds as Int32Array)
      .map((id, i) => (id === g.faceIds[0] ? i : -1))
      .filter((i) => i >= 0);
    s.selectEntities(body.id, faces, "face");
    await execute("offset", { amount: 2 });
    if (useEditor.getState().error) throw new Error(useEditor.getState().error);
    const offset =
      useEditor.getState().geometries[
        useEditor.getState().bodies[0].geometryId
      ];
    s.undo();
    await execute("split", { axis: "z", normal: [0, 0, 1], offset: 15 }, [
      body.id,
    ]);
    if (useEditor.getState().error) throw new Error(useEditor.getState().error);
    return {
      fillet: fillet.kind,
      filletVolume: fillet.diagnostics.volume,
      chamfer: chamfer.kind,
      offset: offset.kind,
      offsetVolume: offset.diagnostics.volume,
      split: useEditor
        .getState()
        .bodies.filter((b: any) => b.visible)
        .map(
          (b: any) =>
            useEditor.getState().geometries[b.geometryId].diagnostics.volume,
        ),
    };
  });
  expect(result.fillet).toBe("brep");
  expect(result.filletVolume).toBeLessThan(27000);
  expect(result.chamfer).toBe("brep");
  expect(result.offset).toBe("brep");
  expect(result.offsetVolume).toBeCloseTo(28800);
  expect(result.split).toHaveLength(2);
  expect(result.split[0] + result.split[1]).toBeCloseTo(27000);
});
test("mesh fillet, chamfer and planar offset produce closed solids", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("stl-input").setInputFiles({
    name: "Cube.stl",
    mimeType: "model/stl",
    buffer: cubeFile(),
  });
  await expect(page.locator(".body-row")).toHaveCount(1);
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts",
      selectionPath = "/src/geometry/selection.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath),
      { featureEdges, surfaceSelection } = await import(selectionPath);
    const s = useEditor.getState(),
      body = s.bodies[0],
      g = s.geometries[body.geometryId],
      edge = featureEdges(g)[0],
      results: any[] = [];
    for (const operation of ["fillet", "chamfer"]) {
      s.selectEntities(body.id, [edge], "edge");
      await execute(operation, { amount: 2 });
      const next = useEditor.getState();
      if (next.error) throw new Error(next.error);
      results.push(next.geometries[next.bodies[0].geometryId].diagnostics);
      s.undo();
    }
    s.updateBody(
      body.id,
      { transform: { ...body.transform, scale: [-1, 1, 1] } },
      "Mirror",
      "mirror",
    );
    s.selectEntities(body.id, [edge], "edge");
    await execute("fillet", { amount: 2 });
    let mirrored = useEditor.getState();
    if (mirrored.error) throw new Error(mirrored.error);
    results.push(
      mirrored.geometries[mirrored.bodies[0].geometryId].diagnostics,
    );
    s.undo();
    s.undo();
    const patch = new Set(surfaceSelection(g, 0, "planar", 20));
    s.selectEntities(
      body.id,
      Array.from({ length: g.diagnostics.triangles }, (_, i) => i).filter(
        (i) => !patch.has(i),
      ),
      "planar",
    );
    s.patch({
      selection: { ...useEditor.getState().selection, mode: "exclude" },
    });
    await execute("offset", { amount: 2 });
    const next = useEditor.getState();
    if (next.error) throw new Error(next.error);
    results.push(next.geometries[next.bodies[0].geometryId].diagnostics);
    return results;
  });
  expect(result[0].openEdges).toBe(0);
  expect(result[0].volume).toBeLessThan(8000);
  expect(result[1].volume).toBeLessThan(8000);
  expect(result[2].openEdges).toBe(0);
  expect(result[2].volume).toBeCloseTo(result[0].volume, 0);
  expect(result[3].volume).toBeCloseTo(8800, 0);
});
test("mesh face offset works in every normal direction and with either sign", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByTestId("stl-input")
    .setInputFiles({
      name: "Faces.stl",
      mimeType: "model/stl",
      buffer: cubeFile(),
    });
  await expect(page.locator(".body-row")).toHaveCount(1);
  const results = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts",
      selectionPath = "/src/geometry/selection.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath),
      { surfaceSelection } = await import(selectionPath);
    const s = useEditor.getState(),
      body = s.bodies[0],
      g = s.geometries[body.geometryId],
      outputs = [];
    for (let face = 0; face < 12; face += 2)
      for (const amount of [2, -2]) {
        s.selectEntities(
          body.id,
          surfaceSelection(g, face, "planar", 20),
          "planar",
        );
        await execute("offset", { amount });
        const next = useEditor.getState();
        if (next.error)
          throw new Error(`Face ${face}, offset ${amount}: ${next.error}`);
        outputs.push({
          amount,
          ...next.geometries[next.bodies[0].geometryId].diagnostics,
        });
        s.undo();
      }
    return outputs;
  });
  for (const result of results) {
    expect(result.openEdges).toBe(0);
    expect(result.volume).toBeCloseTo(8000 + 400 * result.amount, 0);
  }
});
test("history parameter edits recompute solids and cancellation preserves the workspace", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts",
      historyPath = "/src/state/history.ts";
    const { useEditor } = await import(statePath),
      { execute, prepareOperation } = await import(opPath),
      { rebuildHistory } = await import(historyPath);
    await execute("primitive", {
      shape: "cube",
      width: 20,
      depth: 20,
      height: 20,
    });
    await rebuildHistory(0, { width: 40 });
    let s = useEditor.getState();
    if (s.error) throw new Error(s.error);
    const volume = s.geometries[s.bodies[0].geometryId].diagnostics.volume;
    const before = s.bodies[0].geometryId;
    const prepared = await prepareOperation("primitive", {
      shape: "sphere",
      radius: 5,
    });
    s = useEditor.getState();
    return {
      volume,
      before,
      after: s.bodies[0].geometryId,
      count: s.bodies.length,
      preview: Boolean(prepared),
    };
  });
  expect(result.volume).toBeCloseTo(16000);
  expect(result.after).toBe(result.before);
  expect(result.count).toBe(1);
  expect(result.preview).toBe(true);
});
test("suppressed primitives can be restored and obsolete redo branches are discarded", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts",
      historyPath = "/src/state/history.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath),
      { rebuildHistory } = await import(historyPath);
    await execute("primitive", {
      shape: "cube",
      width: 20,
      depth: 20,
      height: 20,
    });
    await rebuildHistory(0, undefined, true);
    const suppressed = useEditor.getState().bodies.length;
    await rebuildHistory(0, undefined, false);
    const restored = useEditor.getState().bodies.length;
    if (useEditor.getState().error) throw new Error(useEditor.getState().error);
    const s = useEditor.getState(),
      b = s.bodies[0];
    s.updateBody(b.id, { visible: false }, "Hide", "visibility");
    s.undo();
    await rebuildHistory(0, { width: 25 });
    const next = useEditor.getState();
    return {
      suppressed,
      restored,
      cursor: next.cursor,
      length: next.history.length,
    };
  });
  expect(result.suppressed).toBe(0);
  expect(result.restored).toBe(1);
  expect(result.cursor).toBe(result.length);
});
test("section handles and native curve selection preserve kernel edge identity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/src/state/operations.ts";
    const { execute } = await import(path);
    await execute("primitive", { shape: "cylinder", radius: 10, height: 30 });
  });
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("button", { name: "Section", exact: true }).click();
  await page.getByLabel("Section offset").fill("15");
  await expect(page.locator(".section-bar")).toBeVisible();
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      selectionPath = "/src/geometry/selection.ts";
    const { useEditor } = await import(statePath),
      { edgeSelection } = await import(selectionPath),
      s = useEditor.getState(),
      g = s.geometries[s.bodies[0].geometryId],
      index = g.edges.findIndex(
        (e: any) => g.nativeRadii[e.kernelId] !== undefined,
      ),
      ids = edgeSelection(g, index, "edge"),
      loop = edgeSelection(g, index, "loop");
    return {
      selected: ids.length,
      loop: loop.length,
      radius: g.nativeRadii[g.edges[index].kernelId],
    };
  });
  expect(result.selected).toBe(48);
  expect(result.loop).toBeGreaterThanOrEqual(48);
  expect(result.radius).toBe(10);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/editor-section.png" });
});
test("sphere and non-uniform native scaling remain editable solids", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(statePath),
      { execute } = await import(opPath);
    await execute("primitive", { shape: "sphere", radius: 10 });
    let s = useEditor.getState();
    if (s.error || !s.bodies.length)
      throw new Error(s.error || "Sphere was not created");
    const body = s.bodies[0];
    s.updateBody(
      body.id,
      { transform: { ...body.transform, scale: [2, 1, 1] } },
      "Scale",
      "transform",
    );
    await execute("primitive", {
      shape: "cube",
      width: 15,
      depth: 15,
      height: 15,
    });
    s = useEditor.getState();
    await execute(
      "union",
      {},
      s.bodies.map((b: any) => b.id),
    );
    s = useEditor.getState();
    if (s.error) throw new Error(s.error);
    const g = s.geometries[s.bodies[0].geometryId];
    return { kind: g.kind, volume: g.diagnostics.volume, brep: !!g.brep };
  });
  expect(result.kind).toBe("brep");
  expect(result.volume).toBeGreaterThan(8000);
  expect(result.brep).toBe(true);
});
test("invalid project selection and cancelled jobs preserve the current body", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("stl-input").setInputFiles({
    name: "Original.stl",
    mimeType: "model/stl",
    buffer: cubeFile(),
  });
  await expect(page.locator(".body-row")).toHaveCount(1);
  const bytes = await page.evaluate(async () => {
    const path = "/src/state/project.ts";
    const { projectBytes } = await import(path);
    return Array.from((await projectBytes()) as Uint8Array);
  });
  const files = unzipSync(new Uint8Array(bytes)),
    manifest = JSON.parse(strFromU8(files["manifest.json"]));
  manifest.selection.refs = [
    {
      bodyId: manifest.bodies[0].id,
      revision: manifest.bodies[0].geometryId,
      kind: "face",
      ids: [-1],
    },
  ];
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  await page.getByTestId("project-input").setInputFiles({
    name: "Invalid.meproj",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync(files)),
  });
  await expect(page.getByRole("alert")).toContainText("invalid entity IDs");
  await expect(page.locator(".body-name")).toHaveText("Original");
  const result = await page.evaluate(async () => {
    const statePath = "/src/state/editor.ts",
      opPath = "/src/state/operations.ts";
    const { useEditor } = await import(statePath),
      { prepareOperation, cancel } = await import(opPath),
      s = useEditor.getState(),
      id = s.bodies[0].geometryId;
    const pending = prepareOperation("primitive", {
      shape: "sphere",
      radius: 10,
    });
    cancel();
    await pending;
    return {
      before: id,
      after: useEditor.getState().bodies[0].geometryId,
      busy: useEditor.getState().busy,
    };
  });
  expect(result.after).toBe(result.before);
  expect(result.busy).toBeNull();
});
