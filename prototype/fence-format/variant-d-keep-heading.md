# 方案 D：保留现有 `---` + `## 角色`，正文包进围栏

> 改动最小：分隔线、角色标题、时间引用全部保留，只把正文代码块化。围栏模式下 `---` 与 `##` 依然存在。

---

---

## 用户

> 12:34

````text
帮我看看这个函数为什么慢：

```ts
export function sum(xs: number[]) {
  return xs.map(x => x * 2).filter(Boolean).reduce((a, b) => a + b, 0);
}
```

我怀疑是 `map` + `filter` 链的问题。
````

---

## ChatGPT

> 12:34

```text
主要开销在三次数组遍历。建议合并成一次 `reduce`：

1. `map` 生成中间数组
2. `filter(Boolean)` 再遍历一次
3. `reduce` 第三次

改成单次循环可以省掉两次数组分配。
```

---

## 插件 (browser)

> 12:34

````text
```json
{ "url": "https://example.com", "status": 200 }
```
````
