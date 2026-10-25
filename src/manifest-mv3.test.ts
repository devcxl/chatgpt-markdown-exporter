import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* MV3 迁移后有几条约束「本地能过、商店会拒」，或者「改错了没有任何报错」：
 *
 *   - Firefox 的 data_collection_permissions 缺失时，AMO 会拒绝新提交
 *   - strict_min_version 低于 109 时，老版本 Firefox 升级后会直接禁用扩展
 *   - Chrome 有 _locales/ 时缺 default_locale 会报 Extension is invalid
 *
 * 这些都属于 manifest 契约，单元测试接触不到产物，因此在源码层面固化。
 * 与 manifest-i18n.test.ts 同款做法：读配置文本做断言，避免在这里跑一次构建。 */

const root = process.cwd();
const wxtConfig = readFileSync(resolve(root, 'wxt.config.ts'), 'utf-8');

describe('Manifest V3 契约', () => {
  it('Chrome 与 Firefox 统一产出 MV3（WXT 对 firefox 默认是 MV2）', () => {
    // WXT 的默认值是 firefox → 2、其他 → 3；必须显式覆盖才是两边同构的 MV3
    expect(wxtConfig).toMatch(/manifestVersion:\s*3\b/);
  });

  it('产物目录是 dist/（WXT 默认 .output/）', () => {
    expect(wxtConfig).toMatch(/outDir:\s*'dist'/);
  });

  it('host 权限放在 host_permissions，而不是混在 permissions 里', () => {
    // MV3 强制拆分：host 匹配模式放进 permissions 会被 Chrome 判为无效权限
    expect(wxtConfig).toMatch(/host_permissions:\s*\[/);

    const permissions = wxtConfig.match(/permissions:\s*\[([^\]]*)\]/)?.[1] ?? '';

    expect(permissions).not.toMatch(/https?:\/\//);
  });

  it('不申请未使用的 activeTab（最小权限）', () => {
    // 下载走 downloads、注入走 scripting，两者所需站点访问已由 host_permissions 覆盖
    const permissions = wxtConfig.match(/permissions:\s*\[([^\]]*)\]/)?.[1] ?? '';

    expect(permissions).not.toContain('activeTab');
    expect(permissions).toContain('downloads');
    expect(permissions).toContain('scripting');
  });

  it('声明 data_collection_permissions（AMO 自 2025-11-03 起强制）', () => {
    expect(wxtConfig).toMatch(/data_collection_permissions:\s*\{/);
    // 本项目不采集任何用户数据，取值必须是 none
    expect(wxtConfig).toMatch(/required:\s*\['none'\]/);
  });

  it('gecko.strict_min_version 不低于 MV3 支持起点 109', () => {
    const minVersion = wxtConfig.match(/strict_min_version:\s*'([\d.]+)'/)?.[1];

    expect(minVersion).toBeTruthy();

    // Firefox 从 109 开始支持 MV3；更低的值会让升级后的老版本直接禁用扩展
    expect(Number.parseFloat(minVersion!)).toBeGreaterThanOrEqual(109);
  });

  it('不手写 background 字段（会覆盖 WXT 的 firefox/service_worker 分支）', () => {
    // Firefox 不支持 background.service_worker，WXT 对 firefox+MV3 自动输出
    // background.scripts；一旦手写 manifest.background 就会绕过该分支，
    // Chrome 或 Firefox 必有一边加载失败。
    expect(wxtConfig).not.toMatch(/^\s*background:/m);
  });
});
