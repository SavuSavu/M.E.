import { mkdir, copyFile, readdir } from "node:fs/promises";
await mkdir("dist/licenses", { recursive: true });
await copyFile("LICENSE", "dist/LICENSE.txt");
await copyFile("docs/THIRD_PARTY.md", "dist/THIRD_PARTY.md");
for (const name of [
  "three",
  "three-mesh-bvh",
  "manifold-3d",
  "opencascade.js",
  "react",
  "react-dom",
  "fflate",
  "zustand",
  "idb-keyval",
  "lucide-react",
  "@fontsource/dm-sans",
  "@fontsource/ibm-plex-mono",
]) {
  const root = `node_modules/${name}`,
    files = await readdir(root),
    license = files.find((file) => /^licen[cs]e(\.txt|\.md)?$/i.test(file));
  if (!license) throw new Error(`License missing for ${name}`);
  await copyFile(
    `${root}/${license}`,
    `dist/licenses/${name.replaceAll("/", "-")}.txt`,
  );
}
