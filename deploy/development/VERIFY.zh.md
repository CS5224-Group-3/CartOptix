# 本地验证指南（Issue #7）

这份文档是给你自己看的速查版：**为什么要验证、验证什么、怎么看结果**。仓库的正式文档是 `RUNBOOK.md`（英文），内容更全，提交 PR 时以它为准。

---

## 0. 一句话

```powershell
powershell -ExecutionPolicy Bypass -File deploy/development/verify-local.ps1
```

这一条命令会把「不需要 AWS 的全部检查」跑完，最后打印一张汇总表，有失败就返回非 0。

---

## 1. 先搞懂 `.yml` 是什么

`.yml`（YAML）是一种**用缩进表达层级的配置文件**。它不是程序，不执行逻辑，只是一张清单。规则只有三条：

- `key: value`，冒号后面**必须有一个空格**
- 用**缩进 2 个空格**表示从属关系，不用大括号
- `-` 开头表示列表项

`.github/workflows/*.yml` 是 **GitHub Actions 的工作流**，也就是「给 GitHub 的机器人读的作业清单」：什么时候干、在哪台机器上干、按顺序跑哪几条命令。

**关键认知：你从来不会"运行"这个文件。** 你 push 到 GitHub，GitHub 读到它然后照着做。所以它的对错只能靠两件事保证：**语法检查**（actionlint）+ **真的跑一次**。

仓库里三个工作流各自管什么：

| 文件 | 什么时候触发 | 干什么 |
|---|---|---|
| `ci.yml` | 每次 PR / push | `pnpm check`、`pnpm build`、actionlint |
| `publish.yml` | **CI 成功之后** | 构建 arm64 镜像，按 commit SHA 打 tag，推到 ECR |
| `deploy.yml` | **Publish 成功之后**，或手动触发 | 通过 OIDC + SSM 让主机执行 `release.sh` |

---

## 2. 验证 = 逐条拿证据

「验证」不是"感觉对了"，而是**逐条证明验收标准成立**。下面是完整对照表。

| 验收标准（原文） | 证据是什么 | 在哪儿能拿到 |
|---|---|---|
| Failing checks block a release | `publish.yml` 用 `workflow_run` 触发，且 `if:` 要求 `conclusion == 'success'` + `event == 'push'` + `head_branch == 'main'`。CI 红了这个 job **根本不会启动** | 静态：读文件 + actionlint PASS |
| No long-lived cloud credentials | 全仓库搜不到 `AKIA…` / `aws_secret_access_key`；工作流里没有任何 `secrets.`；只走 OIDC + repository variables | 静态：全文搜索，已确认零命中 |
| Each release is an **arm64** image tagged with its Git commit | `publish.yml` 里 `platforms: linux/arm64`，两个镜像的 `tags` 只有 `head_sha`，**没有 `latest`** | 静态：读文件 + actionlint PASS |
| The running release can be identified | 镜像 tag = commit SHA，容器 label `com.cartoptix.release` 也等于它 | **本地可证**：脚本检查 label |
| Migrations and seed run **once per release** | 它们在 `compose.yml` 里被放进 `ops` profile，由 `release.sh` 显式 `run --rm` 各一次，不从应用启动流程走 | **本地可证**：看 `release.sh` 输出 |
| Restarts web **after** recreating api | `release.sh` 先 `--force-recreate api` 再 `--force-recreate web`；顺序错了 nginx 会 502 | **本地可证**：`/api/...` 返回 200 |
| Fails the run unless `/health/ready` returns 200 | `release.sh` 轮询 `/health/ready`，拿不到 200 就 `exit 1` | **本地可证** |
| A previous release can be restored without a destructive schema rollback | `deploy.yml` 支持手动触发传 SHA；`release.sh` 接受任意 SHA，回滚 = 重跑 | **本地部分可证**（见第 5 节） |
| Release / rollback / smoke-check steps are documented | `deploy/development/RUNBOOK.md` | 静态 |

---

## 3. 四层阶梯：你现在能做哪几层

| 层 | 证什么 | 需要什么 | 能不能做 |
|---|---|---|---|
| **L1** 静态 | workflow / compose 语法、shell 语法 | 无（`compose config` 不需要引擎） | ✅ 能 |
| **L2** actionlint | workflow 的语法 + 语义 | actionlint 二进制或 Docker | ✅ 能 |
| **L3** 本地 Compose 栈 | **部署脚本真能跑通**、`/health/ready` 200 | 跑着的 Docker 引擎 | ✅ 能（这是 issue 点名要的 assignee 验收项） |
| **L4** 真机 | SSM 部署、ECR 拉取、arm64 镜像、EIP | AWS 账号 + admin 的 4 个前置条件 | ❌ 卡在别人手上 |

**L4 的四个前置条件**（issue 里「Host prerequisites」）都不是你能自己搞定的：

1. 实例挂 `AmazonSSMManagedInstanceCore`
2. 一个 GitHub OIDC role，权限**仅限**对该实例 `ssm:SendCommand`
3. Elastic IP
4. 私有仓库给主机读权限

**还要额外补一条 issue 里没写的**：实例 profile 需要 `AmazonEC2ContainerRegistryReadOnly`。`AmazonSSMManagedInstanceCore` 只管 SSM 通不通，**不管 ECR 拉取**，缺了它主机 `docker compose pull` 会 401。这条建议早点跟 admin 一起提。

---

## 4. 跑起来会看到什么

`-SkipStack` 是「只跑不依赖 Docker 引擎的检查」，可以先验证脚本本身：

```powershell
powershell -ExecutionPolicy Bypass -File deploy/development/verify-local.ps1 -SkipStack
```

实际输出（本机实测）：

```
CartOptix local verification for Issue #7
Repository: D:\download\CartOptix-main\CartOptix-main
Release:   synthetic SHA (this checkout is not a Git repository)
Release:   25f6dfac0ea753a27e4bbbe2a67f351ebf052361
Previous:  18b1134b1c66d91f9342a57efef0dc95d9683619

Environment
  docker engine : 24.0.6
  bash          : C:\Program Files\Git\bin\bash.exe
  bash coreutils: C:\Program Files\Git\usr\bin

=== 1. Static check: workflow files pass actionlint ===
[PASS] actionlint - 3 workflows, no findings (rhysd/actionlint:1.7.12 image)

=== 2. Static check: deploy/development/compose.yml renders ===
[PASS] compose config - YAML and Compose semantics are valid

=== 3. Static check: release.sh shell syntax ===
[PASS] bash -n release.sh - no syntax errors

=== Summary ===
  PASS  actionlint                        3 workflows, no findings (rhysd/actionlint:1.7.12 image)
  PASS  compose config                    YAML and Compose semantics are valid
  PASS  bash -n release.sh                no syntax errors

  3 passed, 0 failed, 0 skipped

Local verification passed.
```

去掉 `-SkipStack`（并确保 Docker Desktop 已启动）就会继续跑第 4、5 步。下面是**本机实测跑通的真实输出**（已删掉 docker 拉取进度条那几百行噪音），可以拿它当验收证据：

```
=== 4a. Building cartoptix-local images for the local architecture ===
    CI builds linux/arm64 natively; this build only exercises the deploy path.
[PASS] build the api image - cartoptix-local/cartoptix-api:<sha>
[PASS] build the web image - cartoptix-local/cartoptix-web:<sha>

=== 4b. Releasing <sha> with release.sh ===
==> Checking host prerequisites
==> Ensuring the persistent Docker resources exist
==> Skipping the image pull (SKIP_PULL=1)
==> Starting PostgreSQL
 Container cartoptix-postgres  Healthy
==> Applying database migrations (once per release)
Database migrations are up to date.
==> Importing the curated seed (once per release)
Seed imported.
==> Recreating api
 Container cartoptix-api  Started
==> Restarting web after api
 Container cartoptix-web  Started
==> Waiting for http://127.0.0.1:8080/health/ready to return 200
Readiness returned 200 on attempt 1.
==> Running release
cartoptix-api  cartoptix-local/cartoptix-api:<sha>  release=<sha>
cartoptix-web  cartoptix-local/cartoptix-web:<sha>  release=<sha>
[PASS] release.sh against a local stack - exit 0 for <sha>

=== 4c. Smoke checks through web ===
[PASS] GET /health/live                        HTTP 200
[PASS] GET /health/ready                       HTTP 200
[PASS] GET /api/v1/catalogue                   HTTP 200
[PASS] GET /api/v1/products?page=1&pageSize=5  HTTP 200
[PASS] GET /                                   HTTP 200
[PASS] cartoptix-api release label             <sha>
[PASS] cartoptix-web release label             <sha>

=== 5. Rolling back to <sha2> ===
    A previous release is identified by its tag alone, so this needs no rebuild.
[PASS] rollback restores a previous release - api runs release <sha2>, no schema rollback

=== Summary ===
  PASS  actionlint                              3 workflows, no findings (rhysd/actionlint:1.7.12 image)
  PASS  compose config                          YAML and Compose semantics are valid
  PASS  bash -n release.sh                      no syntax errors
  PASS  build the api image                     cartoptix-local/cartoptix-api:<sha>
  PASS  build the web image                     cartoptix-local/cartoptix-web:<sha>
  PASS  release.sh against a local stack        exit 0 for <sha>
  PASS  GET /health/live                        HTTP 200
  PASS  GET /health/ready                       HTTP 200
  PASS  GET /api/v1/catalogue                   HTTP 200
  PASS  GET /api/v1/products?page=1&pageSize=5  HTTP 200
  PASS  GET /                                   HTTP 200
  PASS  cartoptix-api release label             <sha>
  PASS  cartoptix-web release label             <sha>
  PASS  rollback restores a previous release    api runs release <sha2>, no schema rollback

  14 passed, 0 failed, 0 skipped

Local verification passed.
```

三个关键字眼要能对上：

- `Readiness returned 200 on attempt 1.` —— 这是 `release.sh` 的部署门禁，**不是**容器 healthcheck。`/health/ready` 不是 200 脚本就 `exit 1`。
- `release=<sha>` 两行 —— 这是「running release can be identified」的直接证据：镜像 tag 和容器 label 都等于那个 commit。
- `14 passed, 0 failed` + 退出码 0 —— 这是给 reviewer 看的结论行。

**注意第 4 步跑完后栈是留着的**（脚本会提示 `docker compose --file ... down` 来停）。所以你可以直接开浏览器访问 `http://127.0.0.1:<WEB_PORT>/` 看真实前端。停了也不影响验证结论，PostgreSQL 的数据卷会保留。

跑完栈还在运行，方便你手动再看一眼。停掉：

```powershell
docker compose --file deploy\development\compose.yml down
```

PostgreSQL 的数据卷会保留，下一次发布直接复用已导入的数据。

---

## 5. 每项检查背后的道理

**① actionlint 为什么要显式列文件？**
actionlint 靠 `.git` 目录来判断项目根在哪。你手上是 ZIP，没有 `.git`，它就报 `no project was found in any parent directories`。显式传路径就绕过了这个依赖。

**② 为什么本地构建用原生架构，不用 `--platform linux/arm64`？**
本地这套跑的是**部署路径**：迁移只跑一次、api 重建后 web 要重启、ready 非 200 要失败。这些逻辑跟 CPU 架构无关。而架构一致性是 CI 的事——`publish.yml` 在 arm64 runner 上**原生构建**，不经 QEMU。本地再模拟一遍只是让 `pnpm install` + `tsc` 慢十几分钟，什么额外的东西都没证明。

**③ release label 为什么能证明「running release can be identified」？**
`docker inspect` 打出来的 `Config.Image` 带 tag，`com.cartoptix.release` 带 label，两者都等于你部署的那个 commit SHA。任何人拿到主机都能一条命令回答"现在跑的是哪个版本"。

**④ 为什么容器 healthcheck 用 `/health/live` 而不是 `/health/ready`？**
两者语义不同：`live` 只回答"进程还在服务吗"，`ready` 回答"依赖就绪了吗"。如果拿 `ready` 当容器 healthcheck，重建 api 的过程中容器会被反复判成 unhealthy 并重启，部署永远绿不了。所以容器用 `live`，**部署门禁用 `ready`**。

**⑤ 为什么必须先重建 api、再重启 web？**
nginx 把 `api` 这个 Docker DNS 名字解析得到的容器 IP 记住了。api 换容器 → IP 变了 → web 不重启就 502。所以 `release.sh` 里是 `--force-recreate api` 之后才 `--force-recreate web`。

---

## 6. 本地证明不了的东西（说清楚，别夸大）

| 证明不了 | 为什么 | 谁来证 |
|---|---|---|
| Deploy workflow 真的能跑 | 需要 OIDC role 和真实实例 | CI + reviewer |
| SSM 能连上主机 | 需要 instance profile | reviewer |
| ECR 能拉取 | 需要 ECR 读权限 | reviewer |
| 打出来的真的是 arm64 镜像 | 本机是 x86，本地构建走原生架构 | CI（`platforms: linux/arm64`） |
| **旧镜像与新 schema 的兼容性** | 本地的"上一个版本"是把同一个构建改了 tag，不是两个不同的构建 | 需要真机上两个真实 release |
| Elastic IP 让地址在 stop/start 后不变 | 需要 AWS | admin |

最后那条尤其要注意：**脚本里的 rollback 检查证明的是"回滚这条路径能走通"，不是"旧版本一定兼容新 schema"**。真正的兼容性靠一条纪律保证——迁移必须向前兼容（加列用 nullable 或带默认值，删列放到之后的 release）。这条已经写进 `RUNBOOK.md` 了。

---

## 7. 常见报错

| 报错 | 原因和修法 |
|---|---|
| `docker: Cannot connect to the Docker daemon ... dockerDesktopLinuxEngine` | 引擎没起，或 CLI 停在旧的 `default` context。启动 Docker Desktop，然后 `docker context use desktop-linux` |
| `verify-local.ps1 cannot be loaded because running scripts is disabled` | 执行策略。按示例加 `-ExecutionPolicy Bypass`，只影响当前那个进程 |
| actionlint 报 `no project was found in any parent directories` | 没有 `.git`。显式列出 workflow 文件，或 `git init` |
| `IMAGE_REGISTRY is required` | 主机上已有的 `.env` 是 Issue #7 之前的版本。补上 `IMAGE_REGISTRY` 和 `RELEASE` |
| `Bind for 0.0.0.0:80 failed` | 80 端口被占。脚本会自己挑一个空闲端口；手工跑就设 `WEB_PORT`，`release.sh` 会在同一端口探测就绪 |
| `unknown flag: --wait` | 主机的 Compose 低于 v2.17，升级 Compose 插件 |
| `manifest for rhysd/actionlint:v1.7.12 not found` | Docker Hub 的镜像标签**没有 `v` 前缀**（是 `1.7.12`），`v1.7.12` 只存在于 GitHub Release。见 `ci.yml` 里的注释 |
| `release.sh: line 23: dirname: command not found`（exit 127） | Windows 上用 Git Bash 跑 `release.sh` 时，`/usr/bin` 不在 `PATH` 上。`release.sh` 本身没问题（Linux 主机上永远能找到 coreutils）；脚本已自动用 `bash -l` 调用。**实测把 `<git>\usr\bin` 前插到 `PATH` 是无效的，那条会被丢掉，只有 `-l` 管用。** |
| `Release failed: ... http://127.0.0.1/health/ready did not return 200` | 这是最核心的失败。脚本会先把 `docker compose ps` 和 api 最后 50 行日志打出来。多半是 api 连不上 postgres，或 seed/migrate 没跑成功 |
| `template parsing error: function "trimPrefix" not defined` | Docker 的模板语言**没有** `trimPrefix`。要用 `{{slice .Name 1}}` 去掉容器名前导的 `/` |
| `template parsing error: function "com" not defined` | 从 PowerShell 把带双引号的模板（如 `{{index .Config.Labels "com.cartoptix.release"}}`）传给 `docker.exe` 时，内层双引号会被吃掉。在 bash 里没这个问题；PowerShell 里改用 `{{json .Config.Labels}}` 再解析 JSON |

---

## 8. 一个坑：`docker info` 失败时也可能返回 0

本机实测：Docker 引擎没起的时候，`docker info` 把错误写到 stderr，**退出码却是 0**。所以脚本不靠退出码判断引擎是否可用，而是要求输出匹配版本号格式（`^\d+\.\d+`）。你自己写检查时也注意这一点。

---

## 9. 交给 reviewer 的东西

PR 正文需要「主机命令 + 预期输出」，全部在 `deploy/development/RUNBOOK.md` 里：

- **Release procedure** — 自动和手动两条路径
- **Rollback** — 重跑上一个 SHA，不需要 schema 回滚
- **Smoke checks** — 5 条 curl 加两条 `docker inspect`，每条都写了预期结果
- **Verifying before merging** — 就是本文档对应的英文版
