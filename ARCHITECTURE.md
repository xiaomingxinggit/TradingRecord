# 架构与约束索引

此文定位实际模块与关键约束；使用说明见 README，进度与交接仅在 TASKS.md。FLOW-01 以单份计划的开仓—持仓—复盘流程替代原三入口和 MT5 关联决策。

## 运行与数据流

Vue 3 + TypeScript + Vite + Element Plus → 本机 Express API → Node.js 内置 SQLite。

- `src/App.vue`：唯一计划入口、主题、帮助与已保存数据导出；`OpeningPlans.vue` 管理列表及同一 plan ID 的三个页签。
- `server/index.mjs`：挂载计划与 OCR API、提供 dist，默认仅监听 127.0.0.1:3001；未知 API 返回 404。
- `server/store.mjs`：统一打开 `data/trading.sqlite`，启用 WAL / 外键，仅初始化计划 store。既有其他业务表不读取、不删除。
- 计划存在 `plans.payload` JSON，截图存在 `plan_images` BLOB；主题偏好在 localStorage，业务数据不依赖浏览器缓存。
- `npm run dev` 启动 API 与 Vite；`npm run build` 仅执行 vue-tsc 与 Vite；`npm start` 提供构建结果。Node 最低版本以 package.json 为准。

## 模块定位

| 模块 | 前端 | 后端与数据 |
| --- | --- | --- |
| 开仓计划 / 三部分调度 | `src/components/OpeningPlans.vue`、`PlanStatusMenu.vue`、`src/plan-status.ts` | `server/plans.mjs`；plans、plan_images |
| 品种 | `src/components/SymbolSelect.vue`、`src/symbols.ts` | 保存代码，默认 XAUUSD，支持自定义 |
| 持仓过程 | `src/components/PlanAdjustments.vue` | `server/plan-adjustments.mjs`；payload.adjustmentJournal |
| 简单复盘 | `src/components/PlanSimpleReview.vue` | `server/plan-review.mjs`；payload.simpleReview |
| 导出 | `src/App.vue` | `server/export.mjs`；计划 store 提供一致快照 |
| OCR | `src/components/PriceOcr.vue`，开仓 / 过程分别集成 | `server/price-ocr.mjs`；本机识别，不持久化识别图片 |
| 导航 / 帮助 / 主题 | `src/components/AppNavigation.vue`、`HelpDialog.vue`、`src/ui/`、`src/plans.css` | Element Plus 语义颜色，截图保持原图 |

## API 边界

| 方法 | 路径 | 所有权与用途 |
| --- | --- | --- |
| GET / POST | `/api/plans` | 列表 / multipart 新计划与截图 |
| GET / PUT | `/api/plans/:id` | 详情 / multipart 开仓正文与截图 |
| PATCH | `/api/plans/:id/status` | 状态及选填放弃原因 |
| GET | `/api/plans/:id/images/:imageId` | 本计划截图 |
| GET / POST | `/api/plans/:id/adjustments` | 过程历史 / 追加价位快照 |
| POST | `/api/plans/:id/emotions` | 追加独立情绪事件 |
| GET / PUT | `/api/plans/:id/review` | 当前简单复盘 / 带 revision 保存 |
| GET | `/api/plans/export` | 全部已保存计划三部分与截图 ZIP |
| POST | `/api/price-ocr` | 识别价位图片 |

旧独立复盘、模拟、报告导入、持仓关联与绑定端点及实现已删除。JSZip 保留用于导出；Cheerio、ExcelJS 及其专用 override 移除；OCR 依赖保留。

## 数据与保存不变量

1. **单一身份**：三部分共用 plan ID。计划可独立存在，不依赖账户、报告或持仓关联。过程 / 复盘需先有已保存计划，不创建另一份业务记录。
2. **字段隔离**：正文 PUT 从最新 payload 合并白名单正文和截图；状态 PATCH 只更新状态及其元数据；过程追加只写 adjustmentJournal；复盘只写 simpleReview。所有写入在 `BEGIN IMMEDIATE` 中读最新值，保留其他部分和历史未知字段，不能通过正文提交覆盖过程 / 复盘。
3. **原计划完整保留**：品种、方向、周期、市场状态、关键结构、理由、截图、三项价位及原收益风险比不变。草稿 / 待执行 / 已执行 / 已放弃沿用原校验，状态与复盘无联动。创建时间不因任何编辑改变，排序按 createdAt 与 id 稳定排序。
4. **价位与情绪分离**：adjustmentJournal 仍为 version 1，包含 groups、requests 和新增 emotions 数组。缺整个 journal 返回空结构；旧 journal 缺 emotions 仅读取时补空，不批量改库。未知版本或不合法顶层结构拒绝读写，不覆盖历史。
5. **调整组**：新组必填 manualTicket，使用独立 UUID；同号不自动合并。已有组按本计划 journal 内的 group ID 定位，保留 origin、manualTicket、createdAt、boundAt、sourceSnapshot 及全部旧 entries。历史 MT5 来源仅作为快照，不再查询关联表，旧组可以继续追加。
6. **价位含义**：新 entry 有 type=price；旧无 type 的 entry 仍为价位快照。entryPrice 选填，stopLoss / takeProfit 为空表示本次未设置，reason 选填；只校验已填价位为正有限数，允许保本 / 锁盈，不套用初始计划方向关系或重算原 R。
7. **情绪含义**：emotions 项含 id、type=emotion、recordTime、groupId、emotion、note。groupId 可空，否则必须属于当前计划；枚举平静 / 焦虑 / 恐惧 / 贪婪 / 急躁 / 其他，note 选填。情绪没有价格字段，不能解释为清空价位。
8. **追加幂等**：价位 / 情绪请求均校验 requestId 与规范化内容签名；相同 ID / 内容返回原成功状态，不重复追加，不更新时间；相同 ID 不同内容返回 409。客户端分别持有两种操作的 ID，失败和刷新历史不更换，成功或对应内容改变才更新。
9. **简单复盘**：simpleReview version 1 包含独立 revision、result、adherence、good、improve、status、updatedAt。缺失默认 revision=0、结果未记录、执行未评定、空总结、draft、updatedAt=null。PUT 必须带当前 revision，冲突返回 409；成功递增版本。结果枚举未记录 / 未结束 / 盈利 / 亏损 / 持平，执行枚举未评定 / 是 / 部分 / 否。完成至少一项非空总结，结果仍可未记录；不计算金额 / 胜率，不改计划状态。

## 前端草稿与在途保护

- Element Plus Tabs 三个面板保持挂载，同一计划查看 / 编辑 / 保存正文不销毁过程和复盘组件。切换保留草稿并显示未保存标签，不自动保存；过程内价位与情绪也分别保存、分别清理成功的草稿。
- OpeningPlans 汇总正文、过程、复盘的 dirty 与 busy；页签切换、返回、导航、换计划及浏览器关闭使用统一保护。读取 / 写入 / OCR / 确认期间阻止离开，返回列表确认全部未保存输入。
- 子组件互相锁定但不向自己回灌 busy，避免 OCR 弹窗被自身 disabled 关闭。挂载时父表单仍在保存，可在 disabled 解除后补读。
- 保存一个部分只更新列表 / 当前计划的时间元信息，不复制响应到其他输入。开仓、价位、情绪、复盘各自独立 form，submit 阻止冒泡；开仓保存按钮明确归属正文 form。
- OCR 捕获 plan ID 与目标持仓，期间锁定切换；结果只写指定草稿。粘贴识别图不会进入正文截图；正文粘贴仅在开仓编辑页签生效。
- 过程和复盘请求有超时、组件代数隔离与卸载取消。错误保留输入；复盘冲突禁用继续提交，用户复制需要保留的文字并确认重新读取后再整理。

## 导出与兼容

- 在同一 SQLite 只读事务中读取计划及截图，事务结束后构建 ZIP。仅导出已保存的三个部分，明确白名单字段；内部 requests、signature、复盘 revision 和旧独立业务不进入 Markdown。
- 每组与每次调整保留原手动编号、完整来源快照及建组 / 历史绑定时间；情绪明确事件类型和可选组关联。文字使用安全代码围栏，截图用生成的序号路径，原文件名不作 ZIP 路径。
- FLOW-01 无表结构迁移、DROP 或批量数据更新，未打开真实库试验。旧实盘 / 模拟表及隐藏字段原样保留；旧可空 account_id 和父表兼容逻辑沿用，不新建空库解决问题。
- 回退或恢复先停服并备份整个 data 目录（包含可能的 WAL / SHM），用完整一致备份恢复；不能把 Markdown ZIP 当数据库备份，不能重新接入旧私人 Git 历史。
- TradingRecord 是唯一开发根目录。真实数据库、报告、截图、凭据和私人历史不入 Git。调度规则只在 AGENTS.md，验证与未验证事项只在 TASKS.md。
