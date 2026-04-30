/**
 * Build-time packaging script.
 *
 * Reads compiled files from dist/, adjusts manifest.json per target,
 * and writes a ZIP archive using the shared ZIP core.
 *
 * Run with: node --experimental-strip-types scripts/package.mjs [firefox|chrome]
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { buildZipBuffer } from "../src/shared/zip-core.ts";

const root = process.cwd();
const distDir = resolve(root, "dist");
const target = process.argv[2];

if (target !== "firefox" && target !== "chrome") {
  throw new Error("打包目标无效，请使用 firefox 或 chrome。");
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(distDir, "manifest.json"), "utf8"));

if (target === "firefox") {
  manifest.background = {
    scripts: ["background.js"]
  };
} else {
  delete manifest.browser_specific_settings;
}

const files = await collectFiles(distDir);

files.push({
  path: "manifest.json",
  content: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  mtime: new Date(),
});

const outputPath = resolve(
  root,
  `${packageJson.name}-${packageJson.version}-${target}.zip`
);

const content = buildZipBuffer(files);

await writeFile(outputPath, Buffer.from(content));

console.log(`已生成 ${target} 安装包：${outputPath}`);

/* ------------------------------------------------------------------ */
/*  Directory traversal                                                */
/* ------------------------------------------------------------------ */

async function collectFiles(dirPath) {
  /** @type {Array<{path: string, content: Uint8Array, mtime: Date}>} */
  const files = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const zipPath = toZipPath(relative(distDir, absolutePath));

    if (zipPath === "manifest.json") {
      continue;
    }

    const fileStat = await stat(absolutePath);

    if (!fileStat.isFile()) {
      continue;
    }

    files.push({
      path: zipPath,
      content: await readFile(absolutePath),
      mtime: fileStat.mtime,
    });
  }

  return files;
}

function toZipPath(filePath) {
  return filePath.split(sep).join("/");
}
