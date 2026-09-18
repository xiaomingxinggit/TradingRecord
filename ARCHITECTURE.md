# 架构与约束索引

此文定位当前模块与关键约束；使用说明见 README，进度和交接仅在 TASKS.md。RESTRUCT-02 的独立计划与订单模型取代 FLOW-01 三阶段共用计划实体及 EXEC-01 必选计划的中间设计。

## 运行与模块

Vue 3 + TypeScript + Vite + Element Plus → 本机 Express → Node.js 内置 SQLite。`server/index.mjs` 默认仅监听 127.0.0.1:3001，提供 API 与 dist；`server/store.mjs` 统一打开 `data/trading.sqlite` 并启用 WAL / 外键。Node 版本及启动命令以 package.json 为准。

| 模块 | 前端 | 后端与存储 |
| --- | --- | --- |
| 导航、帮助、导出、主题 | `src/App.vue`、`AppNavigation.vue`、`HelpDialog.vue`、`src/ui/` | `server/index.mjs`、`server/export.mjs` |
| 交易计划 | `OpeningPlans.vue`、`PlanStatusMenu.vue`、`src/plan-status.ts` | `server/plans.mjs`；plans、plan_images |
| 品种与原计划价位 OCR | `SymbolSelect.vue`、`PriceOcr.vue` | `server/price-ocr.mjs` |
| 计划关联订单 | `PlanLinkedOrders.vue` | orders 的显式关联 API |
| 独立订单、观察、计划对比 | `OrdersWorkspace.vue`、`PlanOrders.vue`、`src/orders.ts` | `server/orders.mjs`、`server/plan-orders.mjs`、`server/order-ocr.mjs` |
| 订单过程与图片 | `OrderProcess.vue` | `server/order-process.mjs`、`server/images.mjs` |
| 订单复盘 | `OrderReview.vue` | `server/order-review.mjs` |
| 历史计划过程 / 总结 | `PlanAdjustments.vue`、`OpeningPlans.vue` 历史页签 | `server/plan-adjustments.mjs`、`server/plan-review.mjs`；原 payload |

组件文件均在 `src/components/`。`plan-orders.mjs` 是独立订单 store 的文件名，不表示订单必须有计划。

## 实体与不变量

1. **计划与订单独立**：一个计划关联零到多笔订单；一个订单关联零或一个计划。未关联订单可以独立记录过程、图片和复盘。新建计划不创建订单，取消计划不取消订单，订单成交不自动改计划状态。
2. **计划意图状态**：draft / ready / untriggered / abandoned / expired 显示草稿 / 待触发 / 未触发 / 取消 / 失效。只有 ready 要求品种、方向、周期和理由完整。旧 executed 原值保留、可编辑正文，显示“旧人工执行标记”，不可新设置，也不是成交证据。取消原因沿用 abandonReason，不因切换状态删除。
3. **计划字段隔离**：正文更新在事务内合并最新 payload 的白名单字段及截图；状态只更新状态元数据。保留历史未知字段、adjustmentJournal、simpleReview。当前正文只编辑 invalidationCondition（界面显示“出场理由”，最多 500 字）；旧 triggerCondition 只读兼容，后续正文保存不得清空或改写。原分析字段、截图、价位与价格距离 R 保留。createdAt 不随编辑变动。
4. **执行进度派生**：计划响应附关联 orders 与 executionCounts，pending / open / closed 分别计数，ended 仅取消与失效，不与 closed 重复。进度不能由计划人工状态推断。
5. **唯一订单身份**：单账户命名空间中 UUID + 全局唯一 TEXT ticket。票号只接受十进制字符串，规范化前导零，禁止经 Number 转换。planId 可 null；新建时归属冲突返回 409，不能用同号复制或转移订单。显式关联只允许 null→有效计划，同计划重试幂等；其他归属拒绝。
6. **挂单与成交分离**：pendingVolume / pendingPrice / pendingTime / expiresAt / orderType 表达挂单；volume / openPrice / openTime 表达实际成交。pending 必须有挂单类型、目标价、挂单量；open / closed 必须有实际开仓价和成交量，closed 还需平仓价。时间未知留空；已填时间按报告时钟 `YYYY.MM.DD HH:mm:ss` 校验日历及前后顺序，不猜时区。应用录入时间为 UTC。
7. **状态与事实合并**：pending 可到 open、closed、cancelled、expired，open 可到 closed；直接 open / closed 建档不补造中间阶段。取消 / 失效只能手工明确结束已有挂单。已确认的品种、方向、实际成交量价时间及平仓事实不能静默覆盖；只补缺或前进，冲突含差异。成交量变化不自动解释为分批成交，暂不支持分批拼单。
8. **观察语义**：reportedSL / reportedTP 为可空截图快照，不改计划或其他过程；reportedProfit 可负、零、空，仅用于 closed，不当作净盈亏，不猜币种，不汇总金额。当前市价、浮盈不能填为平仓结果；收益比例与实际 R 无来源时显示未记录。
9. **追加与重试**：`BEGIN IMMEDIATE` 内核对最新事实与归属。requestId 防传输重试；observationKey 为图片摘要 + 模式 + 行序号，手填使用 UUID。同身份同内容只返回已有成功结果，同身份不同内容返回 409。不同真实观察可重复出现历史价位，不能按内容永久去重。
10. **订单过程**：price / emotion / note 分别追加到独立订单事件表，每条最多 4 张 PNG / JPEG / WEBP、单张 5 MB；MIME 与内容验证复用 images.mjs。图片只通过订单、事件、图片三层归属读取。幂等签名包含图片内容、类型、名称与顺序。情绪不含价格，不清空价位；允许保本、锁盈，不套用原计划价格关系。OCR 临时图不自动持久化。
11. **订单复盘**：独立 revision；字段 result / adherence / analysis / good / improve / emotional / status。有 open / closed 阶段及实际正开仓价、成交量才有资格保存；completed 只允许 closed 且 good / improve 至少一项非空。枚举结果未记录/未结束/盈利/亏损/持平，执行未评定/是/部分/否，情绪化未评定/是/否；文字各 5000 字。版本冲突拒绝覆盖，不改订单或计划状态。
12. **历史只读**：旧计划 adjustmentJournal 与 simpleReview 保留展示和导出；不自动复制为订单记录。旧组可以显式绑定本计划订单，保留手动编号、来源快照及原条目，订单详情按引用追溯。不再提供旧计划过程追加或总结写入接口。

## API 边界

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | `/api/plans` | 列表 / multipart 新计划 |
| GET / PUT | `/api/plans/:id` | 详情 / multipart 正文与截图 |
| PATCH | `/api/plans/:id/status` | 意图状态与取消原因 |
| GET | `/api/plans/:id/images/:imageId` | 计划截图 |
| GET | `/api/plans/:id/orders` | 关联订单 |
| GET | `/api/plans/:id/adjustments` | 旧 journal 与可绑定订单 |
| POST | `/api/plans/:id/adjustments/bind-order` | 显式绑定旧组来源 |
| GET | `/api/plans/:id/review` | 历史计划总结 |
| GET | `/api/plans/export` | 全部计划与全部订单 ZIP |
| GET / POST | `/api/orders` | 独立订单列表 / 确认观察，planId 可空 |
| GET | `/api/orders/:id` | `{order,plan}`，plan 可 null |
| POST | `/api/orders/:id/observations` | 补充同一订单的观察 |
| PATCH | `/api/orders/:id/plan` | 显式关联，接收 planId / revision |
| GET / POST | `/api/orders/:id/process` | `{events,legacy}` / multipart 追加过程 |
| GET | `/api/orders/:id/process/:eventId/images/:imageId` | 过程图片 |
| GET / PUT | `/api/orders/:id/review` | 独立复盘与资格 / 带 revision 保存 |
| POST | `/api/price-ocr` | 原价位识别 |
| POST | `/api/order-ocr/:mode` | pending / open / closed 订单识别草稿 |

订单确认返回 `{order,orders,changed}`，已关联时另附 plan。过程 POST 返回完整 events / legacy 及 event / order / changed。旧报告导入、实盘复盘和模拟练习端点保持移除，不扫描根目录报告。

## 界面与 OCR

- App 两入口统一处理离开确认；订单 workspace 首次跳转等待初始读取，避免初始化 busy 吞掉打开订单操作。同 ID 页签保持挂载，各表单分别保存；父级只更新事实或元信息，不覆盖其他草稿。
- busy / dirty 汇总到页签、返回、换实体与关闭提示；OCR、上传和确认在途锁定目标。disabled 不包含组件自身 busy，避免自锁。请求有代数隔离与卸载取消，失败保留草稿与重试身份；复盘冲突需要明确重读。
- 订单 OCR 使用明确模式与固定浅色完整宽度布局，支持无表头数据行。低置信度保留空值和警告，资金 balance 行排除；逐行核对后才写库。缩放、列顺序、语言、裁剪和其他布局可能无法可靠识别，允许手工补录；没有运行准确率验证。
- OCR-OPEN-02：持仓模式独立按品种、票号、开仓时间、方向、手数、开仓价、SL、TP 裁列，票号与时间不能合并；当前价和浮盈不读入事实。针对完整宽度浅色单行及同比缩放，局部检测分隔线并隔离 SL/TP 右侧按钮，保留数值末位；挂单/平仓与原价位 OCR 继续各自既有路径。实现及静态验证进度见 TASKS；不将构建结果视为识别准确率证据。
- Element Plus 语义颜色贯穿日夜主题，截图保持原图。业务数据不依赖浏览器缓存。

## 持久化、导出与回退

- 原 plans / plan_images 不重建。新独立表为 tr_orders_v1、tr_order_observations_v1、tr_order_requests_v1、tr_order_process_v1、tr_order_process_images_v1、tr_order_reviews_v1。`CREATE TABLE IF NOT EXISTS` 增量初始化；没有 DROP、旧数据迁移或批量改写。旧可空 account_id 与父表兼容沿用，未知历史表保留。
- 升级前先停止所有使用此库的服务，备份整个 data（含可能存在的 WAL / SHM），再运行新版。回退代码不会将新订单变回旧计划过程；保留新表，旧版本不能读取完整新业务。需要数据回退时使用升级前一致备份，并先保存当前完整 data。不用空库替代问题库。本次开发未执行真实库初始化或迁移。
- 同一只读事务获取计划、订单、观察、过程、复盘与图片快照，再生成交易记录.zip。含交易计划.md、交易订单.md、images；含未关联订单。计划用 ID 引用订单，订单实体只输出一次；历史来源和计划总结保留。白名单排除请求、签名和内部观察身份，用户文字使用安全围栏，图片用生成路径。
- ZIP 是阅读资料，不能恢复数据库。旧独立报告复盘 / 模拟数据保留在库中，但不纳入当前界面与导出。真实数据库、报告、截图、凭据与私人 Git 历史不能提交。
