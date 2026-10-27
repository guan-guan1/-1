# 打卡

一个手机优先、可离线使用的打卡 MVP。未登录时记录保存在当前浏览器；登录后会将任务、打卡和备注同步到腾讯云 CloudBase 国内站。

## 功能

- 首页显示当前选中的约束任务，默认是“晚上不点外卖”。
- 可以新建多个打卡任务，在首页任务栏中切换；每项任务拥有独立的打卡记录和月历。
- 新建或编辑任务时可以设置每日打卡时间段；跨午夜时段会把凌晨的记录归到前一天。
- 只有当前任务处于可打卡时间时才能记录当前打卡日；过去没有记录的日期可补录，已有历史记录只读。
- 按钮和日历单元格带有轻量点击反馈动效，并遵从系统的减少动态效果设置。
- 可以编辑当前任务名称和时间段。
- 可以删除当前任务；删除前会二次确认并同时移除该任务的本地打卡记录。至少保留一项任务。
- 每个任务的每个日期可以保存一条文字备注；选中该日期时，有备注才会显示，日历上也会有备注标记。清空内容并保存可删除备注。
- 为选中日期记录“今晚遵守了，完成打卡”或“嘴馋了，没忍住”。
- 小型月历显示当前任务的成功、失败和未记录日期；过去没有记录的日期可补录，已有记录不可修改。
- 在当前可打卡时间内把失败记录改为成功时，会先显示“你真的确定要改吗，你最好真的没点外卖”确认窗口。
- 原单任务版本的数据会在升级后迁移到默认任务中。
- 页面和图标等静态资源可缓存，安装后可离线打开。
- 可注册邮箱账号并登录；登录后首次会将本机已有数据导入云端，其他设备登录后可读取云端任务和记录。
- 打卡或备注变化后自动同步；重新打开页面、联网或切回页面时会拉取云端变化。账号数据按用户隔离。

## 配置 CloudBase 云同步（PostgreSQL / PG 模式）

本项目使用 CloudBase 的 **PostgreSQL（PG 模式）**：客户端通过 `app.rdb()` 直连 PostgREST，权限由**表级 GRANT + 行级 RLS** 两层校验，请求自带登录 JWT。

1. 在 CloudBase 控制台打开 **数据库 → SQL 编辑器**，整段执行 [`cloudbase/user_checkin_data.sql`](cloudbase/user_checkin_data.sql)。脚本会创建 `public.user_checkin_data`（`user_id text` 主键、`state jsonb`、`updated_at`），开启 RLS，授予 `authenticated` 读写，并建立“只能读写自己那一行”的三条策略。
   - **`user_id` 必须是 `text`**：CloudBase PG 模式的用户 ID 是 19 位数字字符串（如 `2115136407327477760`），不是 UUID；建成 `uuid` 会在首次同步时报 `invalid input syntax for type uuid`。如果表已经按旧脚本建过，执行 [`cloudbase/migrations/2026-10-28-user-id-text.sql`](cloudbase/migrations/2026-10-28-user-id-text.sql) 迁移。
   - 若控制台提示 DDL 不能直接执行，把语句包成 `DO LANGUAGE plpgsql $$ BEGIN EXECUTE '...'; END $$` 重试（语句内单引号要写成两个）。
2. 在 **身份认证 → 登录方式** 启用邮箱登录，并开启内置邮件代发。注册和密码恢复都需要邮件验证码。
3. 从控制台的**环境配置 / API 密钥**页复制当前环境的 **Publishable Key**，填入 [`cloudbase-config.js`](cloudbase-config.js)。该 key 设计为可公开；不要在前端或仓库中放置 CloudBase API Key、SecretId 或 SecretKey。
4. **不需要配置“安全域名”**：站点发布在本环境静态托管的默认域名 `https://<环境ID>-<站点ID>.tcloudbaseapp.com` 下，该域名本身就在浏览器 SDK 的默认白名单里（本地开发用 `localhost`）。本项目实测：`https://my-daka-d7g92edvi8d023606-1517594422.tcloudbaseapp.com` 已在白名单内（预检返回 204 并回显该 Origin）。`guan-guan1.github.io` 不属于默认白名单，而免费套餐添加自定义 Web 安全域名会被拒（`OperationDenied.FreePackageDenied`），这也是改用静态托管的原因。

首次登录时，应用会合并本机记录、当前浏览器可访问的旧 Supabase 账号数据和 CloudBase 云端数据，并在替换本机状态前保留本机备份。旧 Supabase 云端数据的导入需要这台浏览器仍保留有效的 Supabase 登录会话且能访问 Supabase。未登录时仍可在本机使用；离线更改保留在本机，联网后再同步。

默认域名是官方标注的“测试用”域名：首次用浏览器直接打开时可能出现“访问提示”中间页（点按确定后一段时间内不再弹）。数据隔离依赖 PG 的 GRANT + RLS，不依赖域名。

## 本地开发与构建

需要 Node.js 20 及以上与 pnpm 12（`package.json` 中声明 `packageManager: pnpm@12.15.0`）。仓库已提交 `pnpm-lock.yaml`，CI 使用 `pnpm install --frozen-lockfile --ignore-scripts`。

```bash
pnpm install
pnpm dev    # 本地开发预览
pnpm build  # 生产构建，输出 dist/
```

构建成功判据：`dist/index.html` 存在，且 `dist/assets/` 下生成带 hash 的 `.js` / `.css`。构建时出现 `Some chunks are larger than 500 kB` 属已知提示（两个云 SDK 被打进同一个 chunk），不阻塞发布。

注意：

- `service-worker.js`、`manifest.webmanifest` 和图标以 `public/` 为**唯一构建输入**（Vite `publicDir`）。根目录下的同名文件是历史副本，不会进入构建；修改这些资源时请改 `public/` 下的那份。
- 仓库目前没有自动化测试与 lint 配置，验证方式为“构建通过 + 手工走一遍打卡/登录流程”。
- 若本机没有全局 Node.js / pnpm，可直接用绝对路径调用构建器，例如 `node <node路径> node_modules/vite/bin/vite.js build`。

## 发布（CloudBase 静态网站托管）

站点发布到本环境的 **静态网站托管**，用它的默认域名访问，因此不需要（也无法在免费套餐下）配置安全域名：

1. 构建：`pnpm build`；本机没有全局 Node 时用 `node <node路径> node_modules/vite/bin/vite.js build`，产物在 `dist/`。
2. 控制台 → **静态网站托管 → 文件管理 → 上传**：把 `dist/` **里面的内容**（`index.html`、`assets/`、`icon-*.png`、`manifest.webmanifest`、`service-worker.js`、`import.html`）上传到**网站根目录**，不要再套一层 `dist/`。
3. 打开 `https://my-daka-d7g92edvi8d023606-1517594422.tcloudbaseapp.com/` 验证：首次直接访问可能出现“访问提示”中间页，点确定后进入；之后登录、打卡、换设备同步各走一遍。

发布前必须确认两件事已就绪：`user_checkin_data` 表与 RLS 策略（`cloudbase/user_checkin_data.sql`）、邮箱登录与内置邮件代发。否则线上会退化为“可以打卡但无法登录/同步”。

GitHub Pages（`.github/workflows/pages.yml`）仍会随 `main` 推送自动部署，但 `guan-guan1.github.io` 不在免费安全域名白名单内，且 Pages 线上仍是旧 Supabase 版本；新站点验证通过后可停用该工作流。回滚方式：控制台静态托管重新上传上一版 `dist/`，或 `git revert` 后重新构建上传。

## 从旧站点迁移本机数据

`localStorage` 按域名隔离：换到 `*.tcloudbaseapp.com` 后，旧站点里的打卡记录不会自动带过来。

1. 在旧站点（`https://guan-guan1.github.io/-1/`）的浏览器控制台执行 `copy(localStorage.getItem('evening-agreement-v4'))`，把结果保存成文本；也可以直接复制整段 JSON。
2. 打开新站点的 [`import.html`](public/import.html)（即 `https://<环境ID>-<站点ID>.tcloudbaseapp.com/import.html`），粘贴备份点“写入并打开应用”。
3. 在应用里登录 CloudBase 账号：首次登录会把本机记录合并进 `user_checkin_data`，之后其他设备就能读到。

## 在手机上安装

这是一个轻量 PWA。部署后用 Android 手机上的 Chrome 打开 `https://<环境ID>-<站点ID>.tcloudbaseapp.com/`，选择“安装应用”或“添加到主屏幕”即可像应用一样启动。换域名后需要在手机上重新“添加到主屏幕”（旧图标的入口仍指向旧站点）。

未登录时请在常用的同一浏览器和设备上使用；清除浏览器站点数据或更换浏览器会清除或无法看到本机打卡记录。应用不会自动读取支付记录。
