import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from './toast.ts';

/* toast 是用户唯一能看到的导出反馈，重点验证：
 * 1) 容器只创建一次并在被移除后重建
 * 2) 消息被 HTML 转义（避免会话标题注入 HTML）
 * 3) 自动消失的定时与 DOM 清理 */

function container(): HTMLElement | null {
  return document.getElementById('cgpt-toast-container');
}

function toasts(): HTMLElement[] {
  return [...(container()?.children ?? [])] as HTMLElement[];
}

describe('showToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('创建容器并插入 toast', () => {
    showToast('导出成功');

    expect(container()).toBeTruthy();
    expect(toasts()).toHaveLength(1);
    expect(container()?.textContent).toContain('导出成功');
  });

  it('多次调用复用同一容器', () => {
    showToast('一');
    showToast('二');

    expect(document.querySelectorAll('#cgpt-toast-container')).toHaveLength(1);
    expect(toasts()).toHaveLength(2);
  });

  it('容器被外部移除后重新创建', () => {
    showToast('一');
    container()?.remove();

    showToast('二');

    expect(container()).toBeTruthy();
    expect(toasts()).toHaveLength(1);
  });

  it('按类型使用不同背景色', () => {
    showToast('成功', 'success');
    const successBg = toasts()[0].innerHTML;

    document.body.innerHTML = '';
    showToast('失败', 'error');
    const errorBg = toasts()[0].innerHTML;

    expect(successBg).not.toBe(errorBg);
  });

  it('默认类型为 info', () => {
    showToast('提示');
    const infoBg = toasts()[0].innerHTML;

    document.body.innerHTML = '';
    showToast('提示', 'info');

    expect(toasts()[0].innerHTML).toBe(infoBg);
  });

  it('消息中的 HTML 被转义，避免标题注入', () => {
    showToast('<img src=x onerror="alert(1)">');

    expect(container()?.querySelector('img')).toBeNull();
    expect(container()?.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('消息中的 & 与 > 也被转义', () => {
    showToast('a & b > c');

    expect(container()?.textContent).toContain('a & b > c');
  });

  it('淡入后约 3.5 秒淡出，再过 200ms 从 DOM 移除', () => {
    showToast('提示');
    const toast = toasts()[0];

    expect(toast.style.opacity).toBe('1');

    vi.advanceTimersByTime(3500);
    expect(toast.style.opacity).toBe('0');
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(200);
    expect(toasts()).toHaveLength(0);
  });

  it('多个 toast 默认出现在右上角固定容器中', () => {
    showToast('一');
    showToast('二');

    expect(container()?.style.position).toBe('fixed');
    expect(toasts()).toHaveLength(2);
  });
});
