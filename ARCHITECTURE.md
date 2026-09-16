# 架构与约束索引

此文用于定位代码和约束，详细使用方式见 README。功能基线 `ef0f90a`；OCR 已随本地提交 `09f0438` 集成，ADJ-01 初版为 `09f0438` / `890b481`，尚未推送，不据此认定已经发布。

## 运行与数据流

Vue 3 + TypeScript + Vite + Element Plus → 本机 Express API → Node.js 内置 SQLite。

- `src/App.vue`：开仓计划 / 交易复盘 / 模拟练习三入口、未保存离开保护、全量导出。当前使用组件状态切换页面。
- `server/index.mjs`：挂载 API、提供 dist、默认仅监听 127.0.0.1:3001。
- `server/store.mjs`：统一打开 `data/trading.sqlite`，启用 WAL 和外键，创建三个模块 store。
- 计划和模拟截图分别保存在数据库图片表的 BLOB 中。主题偏好在浏览器 localStorage；业务记录不在 localStorage。
- `npm run dev` 同时启动 API 和 Vite；`npm run build` 执行 vue-tsc 与 Vite；`npm start` 提供已构建页面。Node 最低版本以 package.json 为准。

## 模块定位

| 模块 | 前端入口 / 公共组件 | 后端 / 数据 |
| --- | --- | --- |
| 开仓计划 | `src/components/OpeningPlans.vue`、`PlanStatusMenu.vue`、`src/plan-status.ts` | `server/plans.mjs`；plans、plan_images；`/api/plans` |
| 品种选择 | `src/components/SymbolSelect.vue`、`src/symbols.ts` | 保存代码，默认 XAUUSD，允许自定义 |
| 实盘复盘 | `src/components/ReviewWorkspace.vue`、`ReviewDetail.vue`、`LinkPositionsDialog.vue`；`src/reviews/` | `server/review-routes.mjs`、`review-parser.mjs`、`review-store.mjs`；`/api/reviews` |
| 模拟练习 | `src/components/PracticeWorkspace.vue`、`PracticeRecord.vue`、`PracticeImages.vue`；`src/practice.ts` | `server/practice.mjs`；tr_practice_records_v1、tr_practice_images_v1；`/api/practice` |
| 导出 | `src/App.vue` | `server/export.mjs`、`practice-export.mjs`；GET /api/plans/export |
| 主题 / 布局 | `src/ui/theme.ts`、`theme.css`、`element-styles.ts`；`src/components/AppNavigation.vue` | Element Plus 暗色变量与项目语义颜色，不反色截图 |
| OCR | `src/components/PriceOcr.vue`、OpeningPlans / PlanAdjustments 集成 | `server/price-ocr.mjs`、index 挂载；本机识别，不持久化识别图片 |
| 持仓调整 | `src/components/PlanAdjustments.vue`、OpeningPlans 集成 | `server/plan-adjustments.mjs`、`server/plans.mjs`；plans.payload.adjustmentJournal；`/api/plans/:id/adjustments` 及 `/bind` |

表中同一单元格省略目录的文件，沿用该单元格前一完整文件路径的目录。

## 必须保持的不变量

1. 计划可独立存在，不绑定账户。草稿/待执行/已执行/已放弃和复盘状态分离。状态 PATCH 独立保存；编辑正文不把状态重置为草稿。时间排序采用创建时间，编辑不改变创建时间。
2. 一个计划可关联多个独立持仓；每个持仓最多关联一个计划。数据库通过 tr_review_links_v1 的 position_id 主键落实约束。首次入场、加仓、重新入场是关联用途，不额外复制计划。
3. MT5 仅导入能可靠识别来源和独立持仓的报告；来源由公司/服务器/账户标识区分，并与持仓编号组合去重。不能凭模糊订单/成交表猜测持仓归属。解析算法改变需单独设计兼容边界。
4. 实盘复盘使用 tr_review_accounts_v1、tr_review_positions_v1、tr_review_links_v1、tr_review_summaries_v1；不重新解释旧 accounts/trades/notes 表。关联或客观结果变化可使复盘待补充，但不覆盖总结和计划分析。
5. 模拟练习是独立手工记录，复盘和看板使用同一批模拟记录；不接 MT5，不提供 K 线播放器。已移除的开平仓、仓位、盈亏、币种录入区不得自行恢复。服务端保留既有隐藏值，新记录缺失值不补为零或当前时间。
6. 盈亏按来源/币种适用口径分组；缺失结果不同于零，不混加不同币种。模拟状态计数与有有效历史盈亏的财务样本分开。
7. 计划/截图与模拟记录/截图分别事务保存；维护服务端校验与复盘版本冲突保护。不得用前端校验替代服务端约束。
8. 全量导出是已保存记录的 Markdown + 图片 ZIP，包含关联复盘及独立模拟记录，按一致快照读取；不包含尚未保存的输入，也不是完整 SQLite 备份。

## 已确定的工程决策

- **ADJ-01 持仓调整链路**：在计划价位下按持仓分组追加止盈/止损快照，绝不覆盖原计划价位。手动组使用独立 UUID，不凭 ticket 自动匹配；已导入组使用来源明确的 position ID，服务端校验属于当前计划。手动组后续只能经用户显式选择已关联持仓来绑定；来源快照保留，解绑实盘关联不删除历史。
- **ADJ-01 保存与兼容**：优先在现有 plans.payload 中使用服务端管理的版本化调整字段，不改数据库结构；旧记录缺失视为空。采用独立事务追加端点与请求 ID 防重复，正文 PUT 和状态 PATCH 不允许替换调整历史。新计划先保存才能记录调整；已有计划详情与编辑页都可访问，调整独立保存须在 UI 清楚说明并保留未保存输入保护。
- **ADJ-01 数据含义**：每次记录保存 entryPrice（参考开仓价，选填）、stopLoss/takeProfit（空值表示本次未设置）、原因（选填）、服务端记录时间。允许保本/锁盈，不套用原计划的止损相对开仓价约束或计算初始 R。只校验已填价格为正有限数，不伪造真实修改时间、订单编号或账户来源。OCR 可靠识别编号才填入，无法可靠识别就手动填；不改 MT5 报告解析器。
- **ADJ-01 草稿与重试**：调整栏是计划表单外的独立组件，同一计划查看/编辑/保存正文时保留实例和草稿。统一离开入口检查两类草稿，OCR 弹窗或写请求在途阻止切换；追加与绑定使用独立 requestId，成功或各自请求内容改变才更换。绑定仅改变组的来源，不清空价位草稿；识别只写入已选目标，识别期间锁定目标。客户端响应按 planId 与请求代数隔离。已解除关联的来源组保留历史，重新关联前不可追加；Markdown 明确输出来源快照和绑定时间，不输出内部 requests/signature。

- **一个开发根目录、一套公开历史**：TradingRecord 是唯一日常入口，另一目录和私人历史仅作本机恢复归档。功能开发直接在此集成，不复制到第二个发布仓库。
- **本地优先**：服务仅本机访问，真实数据不入 Git。迁移/备份必须考虑 WAL，使用一致性备份或停服务后完整复制，不能只随意复制正在写入的主数据库文件。
- **成熟组件与共享逻辑**：复用现有状态、品种、主题、上传及导出实现；是否抽取共享模块取决于真实复用需求，不为统一外观重写业务存储。
- **轻量调度**：模型和交接规则仅在 AGENTS.md；任务状态仅在 TASKS.md。新的跨模块决策在本节追加原因与影响，相关任务卡引用它。
