import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readSTL, topology } from '../src/mesh.js';
const ready = page => expect(page.locator('#busy')).toBeHidden({ timeout: 60000 });
async function example(page, kind = 'box') {
  await page.goto('./'); await page.locator(`[data-example="${kind}"]`).click(); await ready(page);
  await expect(page.locator('#mode-badge')).toHaveText('CAD SOLID');
}
async function exportFile(page, button) {
  const event = page.waitForEvent('download'); await page.locator(button).click(); const file = await event; await ready(page); return file;
}
async function stlOf(download) {
  const bytes = await readFile(await download.path()); return readSTL(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

test('curved CAD fillet, chamfer, failure recovery, undo/redo, STEP and project round trip', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await example(page, 'plate');
  const originalTriangles = await page.locator('#triangles').textContent();
  await page.locator('#edge-details summary').click();
  await page.locator('#edge-list label').filter({ hasText: 'circle' }).first().locator('input').check();
  await expect(page.locator('#selection-count')).toHaveText('1 edge selected');
  await page.locator('#edge-radius').fill('1000'); await page.locator('#apply-edge').click(); await ready(page);
  await expect(page.locator('#toast')).toBeVisible(); await expect(page.locator('#triangles')).toHaveText(originalTriangles);
  await page.locator('#edge-radius').fill('1'); await page.locator('#apply-edge').click(); await ready(page);
  await expect(page.locator('#status')).toContainText('Fillet');
  const filleted = await page.locator('#triangles').textContent(); expect(filleted).not.toBe(originalTriangles);
  await page.locator('#undo').click(); await ready(page); await expect(page.locator('#triangles')).toHaveText(originalTriangles);
  await page.locator('#redo').click(); await ready(page); await expect(page.locator('#triangles')).toHaveText(filleted);
  const stl = await stlOf(await exportFile(page, '#download')); expect(stl.length / 9).toBeGreaterThan(352); expect(topology(stl).open).toBe(0);
  const step = await exportFile(page, '#save-step'); await page.locator('#file-input').setInputFiles({ name: step.suggestedFilename(), mimeType: 'application/step', buffer: await readFile(await step.path()) }); await ready(page);
  await expect(page.locator('#mode-badge')).toHaveText('CAD SOLID'); await expect(page.locator('#triangles')).toHaveText(filleted);
  const project = await exportFile(page, '#save-project');
  const data = JSON.parse(await readFile(await project.path(), 'utf8')); expect(data.brep.length).toBeGreaterThan(100);
  // Playwright downloads use an extensionless temp path; provide its original name.
  await page.locator('#file-input').setInputFiles({ name: project.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(await project.path()) }); await ready(page);
  await expect(page.locator('#mode-badge')).toHaveText('CAD SOLID');
  await expect(page.locator('#triangles')).toHaveText(filleted);
  await page.locator('#edge-details').evaluate(e => e.open = true);
  await page.locator('#edge-list label').filter({ hasText: 'line' }).first().locator('input').check();
  await page.locator('#tab-chamfer').click(); await page.locator('#apply-edge').click(); await ready(page);
  await expect(page.locator('#status')).toContainText('Chamfer');
  expect(errors).toEqual([]);
});

test('STL conversion makes CAD edges that accept a fillet and a chamfer', async ({ page }) => {
  await example(page); const download = await exportFile(page, '#download');
  await page.locator('#file-input').setInputFiles({ name: 'block.stl', mimeType: 'model/stl', buffer: await readFile(await download.path()) }); await ready(page);
  await expect(page.locator('#mode-badge')).toHaveText('STL MESH');
  await page.locator('#convert').click(); await ready(page); await expect(page.locator('#mode-badge')).toHaveText('CAD SOLID');
  await expect(page.locator('#edge-total')).toHaveText('(12)'); await page.locator('#edge-details summary').click();
  await page.locator('#edge-list input').first().check(); await page.locator('#apply-edge').click(); await ready(page);
  await expect(page.locator('#status')).toContainText('Fillet');
  await page.locator('#undo').click(); await ready(page); await page.locator('#tab-chamfer').click();
  await page.locator('#edge-list input').first().check(); await page.locator('#apply-edge').click(); await ready(page);
  await expect(page.locator('#status')).toContainText('Chamfer');
  expect(topology(await stlOf(await exportFile(page, '#download'))).open).toBe(0);
});

test('STL transform, refinement, smoothing, diagnostics and geometry export', async ({ page }) => {
  await example(page); const file = await exportFile(page, '#download');
  await page.locator('#file-input').setInputFiles({ name: 'block.stl', mimeType: 'model/stl', buffer: await readFile(await file.path()) }); await ready(page);
  await page.locator('#scale').fill('2'); await page.locator('#move-x').fill('7');
  await page.locator('#apply-transform').click(); await ready(page); await expect(page.locator('#dim-x')).toHaveText('80.00');
  let positions = await stlOf(await exportFile(page, '#download'));
  expect(Math.min(...Array.from(positions).filter((_, i) => i % 3 === 0))).toBe(-33);
  await page.locator('#undo').click(); await ready(page); await expect(page.locator('#dim-x')).toHaveText('40.00');
  await page.locator('#refine').click(); await ready(page); await expect(page.locator('#triangles')).toHaveText('48');
  await page.locator('#smooth').click(); await ready(page); await expect(page.locator('#status')).toContainText('Smoothed');
  await page.locator('#diagnostics').click(); await ready(page); await expect(page.locator('#diagnostic-result')).toContainText('0 open edges');
  positions = await stlOf(await exportFile(page, '#download')); expect(positions.length / 9).toBe(48); expect(topology(positions).open).toBe(0);
  const project = await exportFile(page, '#save-project');
  await page.locator('#file-input').setInputFiles({ name:'mesh.me', mimeType:'application/json', buffer:await readFile(await project.path()) }); await ready(page);
  await expect(page.locator('#mode-badge')).toHaveText('STL MESH'); await expect(page.locator('#triangles')).toHaveText('48');
});

test('viewport picking, navigation and sculpting change the downloaded geometry', async ({ page }) => {
  await example(page);
  // A top orthographic-looking view gives predictable edge and surface locations.
  await page.locator('[data-view="top"]').click();
  const rect = await page.locator('canvas').boundingBox();
  // Locate an edge by sweeping horizontally across the top half of the object.
  for (let y = rect.height * .15; y < rect.height * .4; y += 6) {
    await page.mouse.click(rect.x + rect.width / 2, rect.y + y);
    if (await page.locator('#selection-count').textContent() !== '0 edges selected') break;
  }
  await expect(page.locator('#selection-count')).not.toHaveText('0 edges selected');
  await page.locator('#clear-selection').click();
  await page.locator('#refine').click(); await ready(page);
  const before = await stlOf(await exportFile(page, '#download'));
  await page.getByRole('button', { name: 'Sculpt surface', exact: true }).click();
  await page.locator('#brush-radius').fill('30'); await page.locator('#brush-radius').dispatchEvent('change');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 10, rect.y + rect.height / 2, { steps: 4 }); await page.mouse.up(); await ready(page);
  await expect(page.locator('#status')).toContainText('Sculpted');
  const after = await stlOf(await exportFile(page, '#download')); expect(after).not.toEqual(before); expect(topology(after).open).toBe(0);
});

test('bad imports and open STL conversion leave the current model intact', async ({ page }) => {
  await example(page);
  await page.locator('#file-input').setInputFiles({ name:'bad.stl', mimeType:'model/stl', buffer:Buffer.from('nothing') }); await ready(page);
  await expect(page.locator('#toast')).toBeVisible(); await expect(page.locator('#mode-badge')).toHaveText('CAD SOLID');
  await page.locator('#file-input').setInputFiles({ name:'bad.step', mimeType:'text/plain', buffer:Buffer.from('invalid') }); await ready(page);
  await expect(page.locator('#toast')).toContainText('not a STEP'); await expect(page.locator('#dim-x')).toHaveText('40.00');
  const open = 'solid open\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid open';
  await page.locator('#file-input').setInputFiles({ name:'open.stl', mimeType:'model/stl', buffer:Buffer.from(open) }); await ready(page);
  await page.locator('#convert').click(); await ready(page); await expect(page.locator('#toast')).toContainText('closed mesh');
  await expect(page.locator('#mode-badge')).toHaveText('STL MESH'); await expect(page.locator('#triangles')).toHaveText('1');
});

test('small screen layout stays within the viewport and loads entirely from local assets', async ({ page }) => {
  const external = []; page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173/') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  await expect(page.locator('#welcome-import')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('[data-example="box"]').click(); await ready(page); await expect(page.locator('#dim-x')).toHaveText('40.00');
  expect(external).toEqual([]);
});
