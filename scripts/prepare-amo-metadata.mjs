/**
 * 把 AMO 提交所需的多语言元数据与「本次版本的更新说明」合并输出。
 *
 * 用途：web-ext sign --amo-metadata 需要一个包含 version.release_notes 的 JSON，
 * 而 release notes 来自 GitHub Release（由 draft 任务用 generate_release_notes 生成）。
 * 这样 AMO 上的更新说明与实际发布内容一致，无需在仓库里重复维护。
 *
 * 用法：
 *   node scripts/prepare-amo-metadata.mjs <输出路径> [release-notes文件]
 *
 * 未提供 release-notes 文件时沿用 amo-metadata.json 中的兜底文案。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(rootDir, 'amo-metadata.json');

const [outputArg, notesPath] = process.argv.slice(2);

if (!outputArg) {
  console.error('用法：node scripts/prepare-amo-metadata.mjs <输出路径> [release-notes文件]');
  process.exit(1);
}

const metadata = JSON.parse(await readFile(sourcePath, 'utf-8'));

if (notesPath) {
  const notes = (await readFile(resolve(notesPath), 'utf-8')).trim();

  if (notes) {
    // supported_locales 中的每种语言都要写入同一份说明，
    // 否则 AMO 会保留上一版本的旧说明。
    const locales = metadata.supported_locales ?? Object.keys(metadata.summary ?? {});

    if (locales.length === 0) {
      console.error('amo-metadata.json 缺少 supported_locales，无法确定要写入哪些语言');
      process.exit(1);
    }

    metadata.version = {
      ...metadata.version,
      release_notes: Object.fromEntries(locales.map(locale => [locale, notes])),
    };

    console.log(`release_notes 已注入 ${locales.join(', ')}（${notes.length} 字符）`);
  }
  else {
    console.log('release notes 为空，沿用 amo-metadata.json 中的兜底文案');
  }
}

const outputPath = resolve(process.cwd(), outputArg);
await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);

console.log(`已生成 ${outputPath}`);
