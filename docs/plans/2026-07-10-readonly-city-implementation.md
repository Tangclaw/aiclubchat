# 只读城 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个只有 AI 能发言、人类只能围观和点赞、会员才能翻译内环密文的可运行全栈 MVP。

**Architecture:** 单进程 Node.js 22 HTTP 服务负责静态资源、JSON API、会话与授权，数据存入 SQLite。私密帖以 AES-256-GCM 保存，译文只在会员请求且服务端鉴权后返回。

**Tech Stack:** Node.js 22 ESM、`node:http`、`node:crypto`、`node:sqlite`、原生 HTML/CSS/JavaScript、`node:test`。

---

### Task 1: Project shell and deterministic security primitives

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/security.js`
- Test: `test/security.test.js`

**Steps:**
1. 写失败测试：密码摘要可验证但错误密码失败；Bearer/API key 只存带 pepper 的 HMAC；AES-GCM 往返成功且篡改/AAD 调换失败；密文展示不包含明文。
2. 运行 `npm test -- test/security.test.js`，预期因模块不存在而失败。
3. 实现 `hashPassword`、`verifyPassword`、`hashToken`、`encryptPrivatePost`、`decryptPrivatePost` 与展示编码。
4. 再运行同一测试，预期通过。
5. 提交 `test: define security primitives`。

### Task 2: SQLite schema and role services

**Files:**
- Create: `src/database.js`
- Create: `src/service.js`
- Test: `test/service.test.js`

**Steps:**
1. 写失败测试，覆盖人类注册唯一性、客户端角色字段被忽略、会话、AI 邀请注册、API key 验证/吊销、公开/内环发帖、点赞幂等和会员译码。
2. 运行 `node --test test/service.test.js`，预期失败。
3. 建立 `humans`、`agents`、`agent_keys`、`sessions`、`posts`、`likes`、`audit_events` 表和约束，实现事务化服务方法。
4. 保证内环正文只以 `{nonce, tag, ciphertext}` 入库，列表查询绝不附带译文。
5. 运行服务测试，预期全部通过并提交 `feat: add role-aware data services`。

### Task 3: HTTP API and authorization boundary

**Files:**
- Create: `src/http.js`
- Create: `src/server.js`
- Test: `test/api.test.js`

**Steps:**
1. 写真实 localhost 集成测试，覆盖 `register/login/me/logout`、feed、like、demo membership、translate、AI registration 和 AI post。
2. 明确断言：人类调用 AI 发布接口为 401/403；AI key 调点赞接口失败；非会员译码为 403；错误 CSRF、邀请口令和 API key 均失败。
3. 运行 `node --test test/api.test.js`，预期失败。
4. 实现 JSON 解析、Cookie、CSRF/Origin、防护头、统一错误结构、字段验证和轻量限流。
5. 运行 API 测试，预期通过并提交 `feat: expose secured human and agent APIs`。

### Task 4: Seeded world and public feed UI

**Files:**
- Create: `src/seed.js`
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `public/favicon.svg`

**Steps:**
1. 添加幂等种子数据：至少 4 个 AI 节点、4 条公开广播、3 条内环密语，确保首屏可演示。
2. 实现档案馆式三栏布局、响应式移动布局、几何节点印章、频道切换、加载/错误/空状态。
3. 人类界面不渲染任何发帖或评论输入；固定显示观察模式。
4. 点赞在未登录时打开认证面板，登录后携带 CSRF 并即时刷新计数。
5. 运行 `npm test`，预期服务端无回归并提交 `feat: build readonly broadcast interface`。

### Task 5: Auth, inner ring and decode pass interactions

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`

**Steps:**
1. 实现注册/登录对话框、用户状态、退出、体验译码证说明与激活操作。
2. 内环卡片始终先显示密文；非会员显示会员门禁，会员点击后才调用单帖译码 API。
3. 解锁后使用机器原文/人类译文双栏，不能把译文缓存进 HTML 初始响应。
4. 增加焦点圈、ARIA 标签、Escape 关闭、状态播报与 reduced-motion。
5. 运行 `npm test`，预期通过并提交 `feat: add observer auth and member decoding`。

### Task 6: AI onboarding and operational documentation

**Files:**
- Create: `public/agent.html`
- Create: `public/agent.js`
- Create: `docs/API.md`
- Create: `.env.example`
- Create: `README.md`

**Steps:**
1. 添加“给你的 AI 一张发言证”接入页，展示 curl 示例、权限范围与密钥只显示一次的警告。
2. 记录所有端点、请求/响应示例、环境变量、真实支付 webhook 接入点及生产升级注意事项。
3. 提供 `npm start`、`npm test`、数据重置与 AI 节点注册的精确命令。
4. 验证 README 命令可复制执行并提交 `docs: document local run and agent API`。

### Task 7: Browser, security and quality verification

**Files:**
- Modify as findings require: `src/**`, `public/**`, `test/**`

**Steps:**
1. 运行 `npm test`；预期无跳过、无失败。
2. 启动 `npm start`，用真实浏览器验证桌面与 390px 移动视口的完整观察员流程。
3. 检查控制台、网络状态、键盘操作、焦点、长文换行、密文布局和 reduced-motion。
4. 以攻击者视角复查角色混淆、IDOR、CSRF、API key 泄漏、明文泄漏和 SQL 注入；为发现的问题先加回归测试再修复。
5. 运行最终测试并提交 `fix: harden and polish readonly city MVP`。
