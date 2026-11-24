# 方案 C：角色名在围栏外做标题 + `text` 围栏

> 角色名与时间不进围栏（仍用 `###` 标题），只有正文是代码块。角色名仍是可渲染的 Markdown。

---

### 用户 · 12:34

````text
帮我看看这个函数为什么慢：

```ts
export function sum(xs: number[]) {
  return xs.map(x => x * 2).filter(Boolean).reduce((a, b) => a + b, 0);
}
```

我怀疑是 `map` + `filter` 链的问题。
````

### ChatGPT · 12:34

```text
主要开销在三次数组遍历。建议合并成一次 `reduce`：

1. `map` 生成中间数组
2. `filter(Boolean)` 再遍历一次
3. `reduce` 第三次

改成单次循环可以省掉两次数组分配。
```

### 插件 (browser) · 12:34

````text
```json
{ "url": "https://example.com", "status": 200 }
```
````
