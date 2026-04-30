# Project-specific rules for AI agents

## GitHub Actions: Secret 最小暴露原则

GitHub Actions workflow 中引用 `secrets.xxx` 时：

- **不要**在 job 级 `env` 中注入 secret —— 这会使其暴露给 job 中所有 step
- **优先**使用 **step 级 `env`**，只在真正需要 secret 的 step 中注入

当需要在多个 step 间复用 secret 是否存在的判断结果时，采用 **前置检查 + output** 模式：

1. 新增一个专门的检查 step，仅在它自己的 `env` 中注入 secret
2. 用 shell 判断并将结果（如 `available=true/false`）写入 `$GITHUB_OUTPUT`
3. 后续 step 通过 `${{ steps.check-id.outputs.available == 'true' }}` 做条件判断

例外：若该 secret 在整个 job 中所有 step 都必然需要，且 scope 受控，可放宽此规则。
