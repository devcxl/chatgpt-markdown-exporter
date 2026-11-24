# 方案 B：ASCII 角色名当围栏标识

> 围栏语言标识用 `User` / `ChatGPT` / `Plugin`（英文，不随 locale 变）；块内第一行放本地化角色名。最接近 #10 与 AMO 用户的原意。

---

````User
用户 · 12:34

帮我看看这个函数为什么慢：

```ts
export function sum(xs: number[]) {
  return xs.map(x => x * 2).filter(Boolean).reduce((a, b) => a + b, 0);
}
```

我怀疑是 `map` + `filter` 链的问题。
````

```ChatGPT
ChatGPT · 12:34

主要开销在三次数组遍历。建议合并成一次 `reduce`：

1. `map` 生成中间数组
2. `filter(Boolean)` 再遍历一次
3. `reduce` 第三次

改成单次循环可以省掉两次数组分配。
```

````Plugin
插件 (browser) · 12:34

```json
{ "url": "https://example.com", "status": 200 }
```
````
