# 方案 A：`text` 围栏 + 角色名在块内首行

> 围栏语言标识固定 `text`；本地化角色名与时间作为块内第一行。块内所有内容都会被当成代码。

---

````text
用户 · 12:34

帮我看看这个函数为什么慢：

```ts
export function sum(xs: number[]) {
  return xs.map(x => x * 2).filter(Boolean).reduce((a, b) => a + b, 0);
}
```

我怀疑是 `map` + `filter` 链的问题。
````

```text
ChatGPT · 12:34

主要开销在三次数组遍历。建议合并成一次 `reduce`：

1. `map` 生成中间数组
2. `filter(Boolean)` 再遍历一次
3. `reduce` 第三次

改成单次循环可以省掉两次数组分配。
```

````text
插件 (browser) · 12:34

```json
{ "url": "https://example.com", "status": 200 }
```
````
