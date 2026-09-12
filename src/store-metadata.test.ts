import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/* amo-metadata.json 是 AMO 商店页文案的唯一来源，且随 release 自动提交。
 * 结构写错不会在本地构建时暴露，只会在提交 AMO 时报 400，因此在此固化约束。 */

const root = process.cwd();
const metadata = JSON.parse(readFileSync(resolve(root, 'amo-metadata.json'), 'utf-8'));

type Messages = Record<string, { message: string }>;

function readLocale(locale: string): Messages {
  return JSON.parse(readFileSync(resolve(root, 'public/_locales', locale, 'messages.json'), 'utf-8'));
}

describe('amo-metadata.json 结构', () => {
  it('包含 AMO 上架必需字段（缺任一都会被提交 API 拒绝）', () => {
    // 首次上架必需项：version.license、name、summary、categories
    expect(metadata.version?.license).toBeTruthy();
    expect(metadata.name).toBeTruthy();
    expect(metadata.summary).toBeTruthy();
    expect(metadata.categories?.firefox?.length).toBeGreaterThan(0);
  });

  it('supported_locales 与各翻译字段的语言键完全一致', () => {
    const locales: string[] = metadata.supported_locales;

    expect(locales.length).toBeGreaterThan(0);

    for (const field of ['name', 'summary', 'description'] as const) {
      expect(Object.keys(metadata[field]).sort()).toEqual([...locales].sort());
    }
  });

  it('每个翻译字段在每种语言下都非空', () => {
    for (const field of ['name', 'summary', 'description'] as const) {
      for (const locale of metadata.supported_locales as string[]) {
        expect(metadata[field][locale]?.trim(), `${field}.${locale}`).toBeTruthy();
      }
    }
  });

  it('不含已失效的 approval_notes（曾引用已删除的 SOURCE_CODE_REVIEW.md）', () => {
    expect(metadata.version).not.toHaveProperty('approval_notes');
  });
});

describe('amo-metadata 与包内 i18n 一致性', () => {
  it('AMO 英文名与包内 extName 一致', () => {
    expect(metadata.name['en-US']).toBe(readLocale('en').extName.message);
  });

  it('AMO 中文名与包内 extName 一致（避免商店与工具栏显示不同名称）', () => {
    expect(metadata.name['zh-CN']).toBe(readLocale('zh_CN').extName.message);
  });
});

describe('包内简短说明的字数上限', () => {
  // Chrome Web Store 对 manifest description 有 132 字符硬限制，
  // 超出会在拖包上传时报 "The description field in manifest is too long"。
  const CWS_DESCRIPTION_LIMIT = 132;

  it.each(['en', 'zh_CN'])('%s 的 extDescription 不超过 132 字符', (locale) => {
    const description = readLocale(locale).extDescription.message;

    expect(description.length).toBeLessThanOrEqual(CWS_DESCRIPTION_LIMIT);
  });

  it.each(['en', 'zh_CN'])('%s 的 extName 非空', (locale) => {
    expect(readLocale(locale).extName.message.trim()).not.toBe('');
  });
});

describe('prepare-amo-metadata.mjs', () => {
  function run(notes?: string): Record<string, unknown> {
    const args = ['scripts/prepare-amo-metadata.mjs', '/tmp/amo-test.json'];

    if (notes !== undefined) {
      writeFileSync('/tmp/amo-notes-test.md', notes);
      args.push('/tmp/amo-notes-test.md');
    }

    execFileSync('node', args, { cwd: root });

    return JSON.parse(readFileSync('/tmp/amo-test.json', 'utf-8'));
  }

  it('注入 release notes 到所有支持的语言', () => {
    const output = run('## 新增\n\n- 某功能') as { version: { release_notes: Record<string, string> } };

    expect(Object.keys(output.version.release_notes).sort())
      .toEqual([...(metadata.supported_locales as string[])].sort());
    expect(output.version.release_notes['en-US']).toContain('某功能');
  });

  it('release notes 为空时沿用兜底文案', () => {
    const output = run('   ') as { version: { release_notes: Record<string, string> } };

    expect(output.version.release_notes['en-US']).toBe(metadata.version.release_notes['en-US']);
  });

  it('不传 notes 文件时输出与源文件一致', () => {
    const output = run();

    expect(output).toEqual(metadata);
  });

  it('原文件的其余字段被完整保留', () => {
    const output = run('notes') as Record<string, unknown>;

    expect(output.name).toEqual(metadata.name);
    expect(output.categories).toEqual(metadata.categories);
    expect((output.version as Record<string, unknown>).license).toBe('MIT');
  });
});
