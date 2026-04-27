import JSZip from "jszip";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

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

const zip = new JSZip();
await addDirectory(zip, distDir);
zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const outputPath = resolve(
  root,
  `${packageJson.name}-${packageJson.version}-${target}.zip`
);

const content = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: {
    level: 9
  }
});

await writeFile(outputPath, content);

console.log(`已生成 ${target} 安装包：${outputPath}`);

async function addDirectory(zipFile, dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      await addDirectory(zipFile, absolutePath);
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

    zipFile.file(zipPath, await readFile(absolutePath));
  }
}

function toZipPath(filePath) {
  return filePath.split(sep).join("/");
}
