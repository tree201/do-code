# 个人开源发布流程

do-code 的 GitHub 源码仓库是 `tree201/do-code`，npm 只发布 CLI 包 `packages/cli`，包名为 `do-code`。

## 首次发布（只做一次）

首次发布需要用个人 npm 账号完成，因为 npm 的 Trusted Publisher 配置位于已创建的包设置中。先在本机完成以下命令：

```bash
npm login
npm whoami
npm run build:agent
npm test
npm run typecheck
npm pack ./packages/cli --dry-run
npm publish ./packages/cli --access public --tag beta
```

这会发布当前的 `0.3.0` 为 Beta；发布前请确认 npm 登录用户名、包名和版本号。发布是不可撤回的版本记录，若有问题请后续用 `npm deprecate` 标注，不要删除已发布版本。

然后到 npm 的 `do-code` Package Settings → **Trusted Publisher** 中添加：

   - GitHub owner: `tree201`
   - Repository: `do-code`
   - Workflow: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`

最后到 GitHub 仓库 Settings → Environments 创建 `npm` 环境；个人发布建议要求自己手动批准，防止误推 Tag 即发布。Private vulnerability reporting 已启用。

Trusted Publishing 使用 GitHub Actions 的 OIDC 身份，不需要将长期 npm Token 存入 GitHub Secrets；公开仓库发布时会自动生成 npm provenance。

## 后续 Beta 发布

在 `packages/cli/package.json` 中递增版本，例如 `0.4.0-beta.1`，提交并推送后再打相同版本的 Tag：

```bash
npm pkg set version=0.4.0-beta.1 --prefix packages/cli
git add packages/cli/package.json
git commit -m "release: v0.4.0-beta.1"
git push origin main
git tag v0.4.0-beta.1
git push origin v0.4.0-beta.1
```

推送 Tag 后，`.github/workflows/publish.yml` 会重新测试、构建、打包、发布 npm，并创建 GitHub prerelease。用户可安装：

```bash
npm install -g do-code@beta
```

## 稳定版发布

在 Beta 的回归测试通过后，递增正式版本、提交并打同名 Tag：

```bash
npm pkg set version=0.4.0 --prefix packages/cli
git add packages/cli/package.json
git commit -m "release: v0.4.0"
git push origin main
git tag v0.4.0
git push origin v0.4.0
```

发布后的最小验收：

```bash
npx --yes do-code@0.4.0 --help
npx --yes do-code@0.4.0 doctor
```

如需撤回有问题版本，请使用 npm deprecate 给出替代版本说明，而不是删除已被用户安装的版本。
