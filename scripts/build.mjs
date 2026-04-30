import { build } from "vite";
import { copyFileSync, cpSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";

const root = process.cwd();
const isWatchMode = process.argv.includes("--watch");

function copyStaticFiles() {
  return {
    name: "copy-static-files",
    closeBundle() {
      mkdirSync(resolve(root, "dist/icons"), { recursive: true });

      copyFileSync(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json"));

      // 复制 public 目录中的 HTML 文件
      const publicDir = resolve(root, "public");

      try {
        for (const entry of readdirSync(publicDir)) {
          if (entry.endsWith(".html") && statSync(resolve(publicDir, entry)).isFile()) {
            copyFileSync(resolve(publicDir, entry), resolve(root, "dist", entry));
          }
        }
      } catch {
        // public 目录可能尚不存在
      }

      try {
        cpSync(resolve(root, "public/icons"), resolve(root, "dist/icons"), {
          recursive: true
        });
      } catch {
        // 开发早期可能还没有图标
      }

      try {
        cpSync(resolve(root, "_locales"), resolve(root, "dist/_locales"), {
          recursive: true
        });
      } catch {
        // _locales 目录可能尚不存在
      }
    }
  };
}

function createBuildConfig(options) {
  return {
    configFile: false,
    root,
    plugins: options.withStaticFiles ? [copyStaticFiles()] : [],
    build: {
      outDir: "dist",
      emptyOutDir: false,
      sourcemap: false,
      watch: isWatchMode ? {} : undefined,
      rollupOptions: {
        input: resolve(root, options.input),
        output: {
          entryFileNames: options.entryFileName,
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
          inlineDynamicImports: true
        }
      }
    }
  };
}

rmSync(resolve(root, "dist"), {
  recursive: true,
  force: true
});

await build(createBuildConfig({
  input: "src/background.ts",
  entryFileName: "background.js"
}));

await build(createBuildConfig({
  input: "src/content/index.ts",
  entryFileName: "content/index.js"
}));

await build(createBuildConfig({
  input: "src/popup/index.ts",
  entryFileName: "popup/index.js",
  withStaticFiles: true
}));
