# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 工程化约定（流水线必读）

- **版本钉死**：`frontend/package-lock.json` 是唯一版本清单，依赖版本全部精确（无 `^`/`~`）；
  本地 `make install`（`npm ci --cache .cache/npm-<提交号>`）与镜像 `Dockerfile` 里的 `npm ci`
  都照这份清单取，不再出现「本地装的版本和镜像里不一样、构建过了起来报错」。改依赖后
  `npm install` 更新锁清单并一并提交。
- **缓存按提交重建**：npm 与 Vite 的缓存目录都带当前提交号（Makefile 的 `COMMIT_SHA`，
  compose 通过 build arg 透传进镜像 `VITE_CACHE_DIR`），切提交即换目录，不串旧缓存。
- **两条数据入口读同一套样例**：样例单一真源是 `frontend/src/data/seed-rows.json`，
  Node 脚本与浏览器都读它，归一化/校验/联动的共享实现是 `frontend/src/data/kernel.js`。
  - `make prepare`（`npm run prepare:samples`）：准备入口，把样例灌进发布制品
    `public/data/prepared-samples.json`（`prebuild` 自动执行，构建必带样例）。按 id 幂等
    upsert，重复执行不翻倍；`.data/prepare-journal.json` 记步骤，跑一半停了再跑只续未完成步。
  - `make reset`（`npm run reset:samples`）：恢复入口，清进度与制品后按同一份样例重建初始状态。
- **范围校验**：`距隧道距离/允许沉降/实测沉降` 与沉降四项的区间在共享内核里定义，准备阶段
  越限即报错并以非零码退出；页面登记也走同一校验。
- **存量兼容**：旧数据读取时就地迁移——id 统一成 number、缺字段照样例补、`createdAt` 按创建
  先后回填、地表沉降按建筑对象补齐，记录只修不丢，不整块丢弃。
- **同源同步**：地表沉降不单独维护样例，由建筑监测同源派生，建筑监测页与地表沉降页的条数
  （`prepare` 也会校验一致）和指标数字都来自同一份数据与同一统计算法。
- **登记事务**：同一对象编号重复提交只记一次；建筑记录与联动沉降测点在同一事务落库，
  写库失败就地撤销内存与 `localStorage`，不留半截。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── scripts/              prepare-samples / reset-samples 两个入口
│   ├── public/data/          准备入口产出的样例制品（随 dist 发布）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出、登记事务
│   ├── src/data/kernel.js    共享内核：归一化/范围校验/回填/沉降联动/指标（Node 与浏览器共用）
│   ├── src/data/seed-rows.json    样例单一真源
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   ├── Dockerfile            node 钉版本构建 + nginx 静态托管
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── Makefile                  install/prepare/reset/build/image 入口（缓存按提交号隔离）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
make install      # 按锁清单装依赖（等价 cd frontend && npm ci）
make frontend     # 开发
make build        # 先 prepare 灌样例再构建，dist 里自带样例
make image        # 构建镜像（提交号透传，缓存按提交隔离）
```

或手工：

```bash
cd frontend
npm ci
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建（先执行准备入口，制品含样例）：

```bash
cd frontend
npm run build
```

镜像为多阶段构建：node 镜像里 `npm ci && npm run build`，最终用 nginx 托管 `dist`，
compose 下访问端口仍是 `http://localhost:5173/`。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 盾构机台账 | `shield` | 盾构机 | 盾构机编号、盾构机型号、开挖直径 |
| 掘进环次 | `ring` | 掘进环 | 环号、起始里程、掘进速度 |
| 管片拼装 | `segment` | 管片环 | 管片环号、管片型号、拼装点位 |
| 同步注浆 | `grouting` | 注浆记录 | 注浆编号、对应环号、浆液配比 |
| 渣土外运 | `muck` | 渣土运输单 | 运输单号、对应环号、渣土方量 |
| 地表沉降 | `settlement` | 沉降测点 | 测点编号、测点位置、初始高程 |
| 轴线偏差 | `axis` | 轴线测量 | 测量编号、对应环号、设计轴线 |
| 刀具磨损 | `cutter` | 刀具 | 刀具编号、刀盘位置、刀具类型 |
| 管片生产 | `segmentprod` | 管片 | 管片编号、管片型号、生产模具 |
| 浆液拌制 | `mortar` | 浆液批次 | 批次编号、浆液类型、水泥用量 |
| 洞内通风 | `ventilation` | 通风机组 | 机组编号、风筒长度、送风量 |
| 建筑监测 | `building` | 监测对象 | 对象编号、建筑物名称、结构类型 |
| 管线探查 | `utility` | 地下管线 | 管线编号、管线类型、埋设深度 |
| 进度节点 | `progress` | 进度节点 | 节点编号、节点名称、计划完成日 |
| 试验检测 | `testing` | 试验委托 | 委托编号、试样类型、检测项目 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练科目、演练日期 |
| 班组进场 | `crew` | 施工班组 | 班组编号、班组名称、主要工种 |
| 安全巡检 | `safety` | 巡检记录 | 巡检编号、巡检区域、巡检项目 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：`make reset`（或 `cd frontend && npm run reset:samples`）恢复制品初始样例；
  浏览器里可点建筑监测页「恢复初始样例」按钮，或清掉 `shield-tunnel-construction:entries`
  这一项，也可调用 `resetModule(模块)`。
