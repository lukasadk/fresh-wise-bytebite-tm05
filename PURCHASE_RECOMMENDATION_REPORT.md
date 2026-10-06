# 下次购买推荐与过量购买识别：看板验收报告

## 结论

本功能按 Google Drive 中的 `FreshWise_Iteration_3.pptx`、LeanKit Epic 7/8 验收规则和 FreshWise Figma 概念稿实现为 **手机 App 调用 FastAPI** 的规则型服务，不训练、加载或依赖本地机器学习模型。所有结果只来自当前设备用户最近 8 周的购买、消耗、浪费记录和当前未过期库存；API 会把计算证据一起返回，App 负责展示、编辑确认和加入购物清单。推荐从首次购买起即可提供，但少于 3 个购买日期时按 AC 7.1.4 显示 `Not enough history`，并隐藏浪费率；至少 3 次购买且有 outcome 才显示浪费率并参与过量购买判定。

2026-10-06 修正了历史单位选择、食品分类词表和 AC 7.1.4 的展示契约；看板本身未被修改。

## 计算契约

同名商品会先去除首尾/重复空格并忽略大小写后分组。一个购买日期视为一次 purchase trip；同一天同名商品先合并。

```text
original purchased = current remaining + consumed + wasted
average purchased  = Σ original purchased / purchase trips
average consumed   = Σ consumed / purchase trips
average wasted     = Σ wasted / purchase trips
waste rate         = Σ wasted / (Σ consumed + Σ wasted)
weekly consumption = Σ consumed / 8

days until next shop = 至少 2 个不同购买日期时的平均日期间隔，否则 7
reliable demand      = weekly consumption × days until next shop / 7
early demand         = 有 outcome 时使用 average consumed；否则使用 average purchased
raw recommendation   = selected demand − current non-expired stock
recommended quantity = ceil(max(0, raw recommendation))
```

状态判定：

- 推荐量为 0：`DO_NOT_BUY_YET`。
- 推荐量低于通常购买量的 80%：`BUY_LESS`。
- 推荐量高于通常购买量的 120%：`BUY_MORE`。
- 其余：`KEEP_SAME`。
- 首次购买即提供购买建议；少于 3 次时为 `Still Learning / Not enough history`，且不返回可展示的浪费率。
- 至少 3 次购买且浪费率不低于 30%：`Possible Over-Purchase`；否则为 `On Track`。

系统按最近 8 周记录中出现最多的兼容单位族选择计算单位，不再由最新一条记录决定；同票时才以最新记录决胜。`g/kg`、`mL/L` 等精确可换算单位会统一计算；bag、box、carton 等没有可靠换算关系的单位不会猜测，相关记录会被排除并返回 `warnings`。分类归一化已覆盖 Salmon、Tilapia、Turkey、Tomatoes、Zucchini，并优先把 Orange Juice 等含 `juice` 的名称归为 Beverages。

每个推荐额外返回 `summary`：使用相同的规则输入概括购买结论、最近 8 周购买次数、通常购买量、当前库存和数据可信度。少于 3 次购买时只说明仍需多少次记录，不显示实际浪费率。App 的 Buying Habits 页面另有一张 `8-week summary` 卡片，汇总 Needs attention、On track 和 Still learning 的商品数量。

## 逐条验收结果

| 验收项 | 状态 | 实现证据 |
|---|---|---|
| AC 7.1.1 最近 8 周逐商品指标 | 已实现 | API 返回 trips、三项平均值、outcome waste rate、非过期库存；名称忽略大小写和重复空格分组 |
| AC 7.1.2 Activity → Buying Habits | 已实现 | Overview 卡片和 `View All`；列表按浪费率降序 |
| AC 7.1.3 过量购买标记 | 已实现 | 3 次且 waste rate ≥ 30% 为 Coral Red；否则 Forest Green |
| AC 7.1.4 Still Learning | 已实现 | 少于 3 次仍放到底部并显示 `Not enough history`，浪费率显示为 `—`；建议本身仍可提前提供 |
| AC 7.1.5 查看证据 | 已实现 | Item Purchase Insight 的 purchased/consumed/wasted 三条横向证据条及指定颜色；返回时保留列表页面和滚动位置 |
| AC 7.1.6 空状态 | 已实现 | 无 consumed/wasted 记录时显示指定文案和 `Go to Pantry` |
| AC 7.2.1 推荐数量公式 | 已扩展冷启动 | 可靠历史沿用 weekly consumption；早期建议按已记录 consumption 或 usual purchase，均扣除非过期库存 |
| AC 7.2.2 购物间隔 | 已按产品决定调整 | 至少 2 个不同日期取平均间隔；只有 1 个日期时使用 7 天 |
| AC 7.2.3 四种推荐状态 | 已实现 | 0、80%、120% 边界按看板定义判定 |
| AC 7.2.4 Next Shop 展示 | 已实现 | 独立 Next Shop 页面展示 badge、大号数量、单位、usual quantity 和四种指定颜色 |
| AC 7.2.5 数据刷新 | 已实现 | Buying Habits 与详情页每次重新获得焦点时重新调用 API 计算 |
| AC 7.3.1 原因文案 | 已实现 | 四种状态由 API 返回看板指定模板，不调用 LLM 生成 |
| 建议总结 | 已实现 | API 返回逐商品事实总结；Buying Habits 汇总三种可信度/风险状态，不调用 LLM |
| AC 7.3.2 数量对比 | 已实现 | `Show comparison` 展开 Usual/Recommended 两条带数字的对比条 |
| AC 7.3.3 编辑数量 | 已实现 | bottom sheet、0–99 stepper、Confirm/Cancel、`Set by you`、绿色 `Quantity updated` toast |
| AC 7.3.4 加入购物清单 | 已实现 | 复用 Lukas 的 Epic 8 UUID 清单契约；按钮确认后变为 `View Shopping List`；编辑建议数量会写回清单且不再被自动同步覆盖 |

## API

购买习惯与单项推荐：

```http
GET  /v1/purchase-insights
GET  /v1/purchase-insights/{item_name}
POST /v1/purchase-insights/recommend
POST /api/shopping/recommend
```

POST 请求体：

```json
{"food_name": "Milk"}
```

购物清单：

```http
GET    /v1/shopping-list
POST   /v1/shopping-list/items
PATCH  /v1/shopping-list/items/{list_item_id}
DELETE /v1/shopping-list/items/{list_item_id}
```

App 沿用现有 `X-Device-Id` 身份机制和 API 配置，不需要新增模型服务、模型权重或训练流水线。`backend/app/schema/003_shopping_list.sql` 是幂等迁移，`AUTO_APPLY_SCHEMA` 启动流程会对已有数据库检查并执行。

## 主要实现文件

- `backend/app/purchase_insights.py`：8 周聚合、指标、推荐公式、状态与解释原因。
- `backend/app/routers/shopping.py`：Lukas Epic 8 购物清单查询、新增、状态/数量更新、删除和建议同步。
- `backend/app/schemas.py`、`backend/app/models.py`：公开响应契约和 ORM。
- `src/screens/ActivityScreen.tsx`：Buying Habits 入口卡片。
- `src/screens/BuyingHabitsScreen.tsx`：8 周总览、排序、状态区和空状态。
- `src/screens/PurchaseInsightScreen.tsx`：过量购买提示、8 周证据、统计卡、未过期库存和 Next Shop 入口。
- `src/screens/NextShopScreen.tsx`：推荐总结、推荐量、解释、对比、计算证据、数量编辑和购物清单联动。
- `backend/tests/test_purchase_insights_unit.py`：看板公式、阈值、8 周窗口、单位、路由和 schema 测试。

## 验证结果

- 购买建议纯逻辑专项测试：`18 passed`；覆盖多数单位优先、兼容单位换算、5 个新增食品分类、少于 3 次隐藏浪费率和公开 API 契约。
- 全部不依赖 PostgreSQL 的后端单元测试：`64 passed`，另有现有 Pydantic/FastAPI 弃用警告 5 条。
- TypeScript 类型检查：通过，`tsc --noEmit` 无错误。
- Expo Web 生产导出：通过，2,504 个模块成功打包。
- Shopping List schema 与 OpenAPI smoke test：通过。
- Buying Habits 空状态已在本地 Expo Web 中实际打开并视觉核对。
- PostgreSQL 集成测试未完成：本机没有 Docker，配置的本地 PostgreSQL 端口拒绝连接；测试在 fixture 建连阶段停止，没有产生业务断言失败，也没有虚报通过数量。
