# IczpNet 代码生成器方案（Entity-First）

## 1. 目标与边界

构建一个面向 ABP vNext / DDD 项目的本地代码生成器：开发者先维护领域实体，生成器通过 Roslyn 分析实体，再按项目约定、模板配置和实体级差异配置生成应用层及基础设施代码。

产品包含两个入口，但只有一套核心能力：

- `abpgen` CLI：供脚本、CI、批量生成与 AI 调用。
- `abpgen ui`：启动本地 ASP.NET Core 服务，在浏览器中提供配置、预览、Diff 与生成操作。

第一期不做中心化服务或数据库。配置、模板和生成状态全部保存在目标项目的 `.codegen/` 下，随 Git 提交和评审。

不由生成器维护的内容：领域实体、领域行为、领域 Manager、枚举及业务规则。生成器也不应覆写开发者维护的扩展文件。

## 2. 核心原则

> Entity 决定“领域数据是什么”；Profile 决定“项目通常长什么样”；Convention 决定“默认如何处理”；Descriptor/Override 决定“此实体有哪些例外”。

生成模型为：

```text
EntityModel + Project Convention + TemplateProfile + GenerationDescriptor
    => GenerationModel
    => Templates
    => Generated Code
```

关键约束：

1. **Entity 是唯一结构来源**。配置中不重复保存属性类型、可空性、基类或主键等可由 Roslyn 得到的信息。
2. **默认优先于配置**。Profile 与 Convention 覆盖大多数常规实体，UI 只编辑例外项。
3. **所有生成先预览再写盘**。生成计划和 Diff 必须可见；写盘只发生在用户明确执行 Generate 时。
4. **生成代码与手写代码隔离**。使用 `.g.cs`、`Base.g.cs`、partial 或基类扩展模式，避免重新生成破坏业务代码。
5. **CLI、Web、以后 IDE 插件只做适配**。它们依赖同一个 Application/Generation 服务，Core 不依赖 UI 或 CLI。
6. **配置必须可版本化**。`.codegen` 是团队共享的项目资产，禁止只存于本机数据库。

## 3. 总体架构

```text
                         ┌───────────────┐
                         │ CLI: abpgen   │
                         └───────┬───────┘
                                 │
┌────────────────┐               │
│ Vue 3 Web UI   │── Local HTTP ──┼──► Application / Generation Services
└───────┬────────┘               │       ├─ Metadata Service
        │                        │       ├─ Profile / Descriptor Service
        │                        │       ├─ Plan / Preview / Diff Service
        │                        │       └─ Generate / Validate Service
        ▼                        ▼
   Browser UI              Generator Core
                                 ├─ Roslyn analysis
                                 ├─ Convention resolver
                                 ├─ Scriban templates
                                 ├─ File modification guards
                                 └─ Format / build integration
                                        │
                                        ▼
                              Current ABP solution
```

推荐技术栈：.NET 10（或与现有 ABP 项目一致的 LTS SDK）、`Microsoft.CodeAnalysis`、Scriban、`System.CommandLine`、ASP.NET Core Minimal API、Vue 3 + TypeScript + Vite。UI 如需与现有后台统一，可接入 Vben Admin / Ant Design Vue；第一期无需 Electron 或 Blazor。

本地 Web Host 由 `abpgen ui` 启动，默认只绑定 loopback 地址；它能自然获得当前项目目录、Git 工作区、.NET SDK 和 NuGet 环境，避免远程服务直接修改开发者电脑源码的安全与部署问题。

## 4. 工程拆分与依赖

```text
src/
  IczpNet.CodeGenerator.Abstractions/  # 公共请求、结果、接口
  IczpNet.CodeGenerator.Core/          # 模型、规则、模板抽象、文件计划
  IczpNet.CodeGenerator.Roslyn/        # Solution 扫描、Entity 分析、受控 C# 修改
  IczpNet.CodeGenerator.Generation/    # 合并、渲染、预览、Diff、写盘、验证
  IczpNet.CodeGenerator.Cli/           # System.CommandLine 命令适配器
  IczpNet.CodeGenerator.Web/           # 本地 API Host、静态 UI 托管
ui/
  IczpNet.CodeGenerator.WebUi/         # Vue 3 SPA
tests/
  IczpNet.CodeGenerator.Core.Tests/
  IczpNet.CodeGenerator.Roslyn.Tests/
  IczpNet.CodeGenerator.IntegrationTests/
```

依赖方向：

```text
Abstractions ← Core ← Roslyn
                    ← Generation ← CLI
                                  ← Web
```

`Core`、`Roslyn` 和 `Generation` 不引用 CLI/Web。CLI 与 Web 只将参数映射为同一套 `IGenerationService` 请求。

## 5. 关键模型

### 5.1 EntityModel：Roslyn 的只读分析结果

`EntityModel` 只回答实体客观上是什么：名称、命名空间、主键类型、ABP 基类、审计/多租户能力、属性、导航属性、标准数据标注与可推导约束。

```csharp
public sealed record EntityModel(
    string Name,
    string Namespace,
    TypeReference KeyType,
    TypeReference? BaseType,
    EntityCapabilities Capabilities,
    IReadOnlyList<EntityPropertyModel> Properties,
    IReadOnlyList<NavigationModel> Navigations,
    string Fingerprint);

public sealed record EntityPropertyModel(
    string Name,
    TypeReference Type,
    bool IsNullable,
    bool IsCollection,
    PropertyConstraints Constraints,
    bool IsSystemManaged);
```

识别范围至少包含 `AggregateRoot` / `FullAuditedAggregateRoot`、`IMultiTenant`、`IHasConcurrencyStamp`、`[Required]`、`[StringLength]`、`[MaxLength]`、枚举、`Guid` / `long` / `DateTime` / `decimal` 等常用类型。`protected set` 不能单独作为“不允许更新”的判断依据；DDD 实体常使用它，最终暴露规则由 Convention 与 Descriptor 决定。

### 5.2 TemplateProfile：项目级默认策略

Profile 选择模板、文件布局、各层生成模式与按类型的默认字段策略。支持 `existing`、`direct`、`base`、`partial`、`none` 五种模式。

```json
{
  "$schema": "../schemas/profile.schema.json",
  "name": "iczp-ddd",
  "patterns": {
    "entity": "existing",
    "dto": "direct",
    "repository": "base",
    "appService": "base",
    "efConfiguration": "base",
    "mapper": "direct",
    "controller": "none"
  },
  "defaults": {
    "string": { "dto": true, "create": true, "update": true, "filter": "contains" },
    "enum": { "dto": true, "create": true, "update": true, "filter": "equals", "sortable": true },
    "dateTime": { "dto": true, "filter": "range", "sortable": true }
  },
  "permissions": { "enabled": true, "create": true, "update": true, "delete": true }
}
```

### 5.3 GenerationDescriptor：实体级最小差异

UI 编辑并保存 `GenerationDescriptor`。其内容只保存相对 Profile/Convention 的偏差：选择的 Profile、生成模块、CRUD、字段暴露、查询、验证覆盖和前端展示元数据。

```json
{
  "$schema": "../schemas/entity.schema.json",
  "entity": "IczpNet.Article.Articles.Article",
  "entityFingerprint": "sha256:...",
  "profile": "iczp-ddd",
  "generation": { "dto": true, "repository": true, "application": true, "efCore": true, "permissions": true },
  "crud": { "get": true, "getList": true, "create": true, "update": true, "delete": true },
  "properties": {
    "Title": { "query": { "filter": "contains", "sortable": true } },
    "PublishTime": { "query": { "filter": "range", "sortable": true } },
    "ViewCount": { "exposure": { "create": false, "update": false } }
  }
}
```

字段配置分为四组，避免把 DTO、查询和页面展示混成一个 `visible`：

| 分组 | 用途 |
| --- | --- |
| Exposure | `dto`、`create`、`update`、`list`、`detail` |
| Query | 过滤方式、排序、默认排序 |
| Validation | Required、长度、数值范围、正则等覆盖 |
| Presentation | 标签、列宽、列表/详情/表单可见性、控件类型、排序 |

`Presentation` 为未来 Vue/Vben、Flutter、TypeScript Client 复用预留；它不反向污染领域实体。

### 5.4 GenerationModel 与 GenerationPlan

`GenerationModel` 是已合并、可直接渲染的内部模型；模板永远不自行读取 JSON 或猜测默认值。

`GenerationPlan` 是一次生成的纯计划，含每个输出文件的：目标路径、来源模板、动作（Create/Update/Skip/Conflict）、新内容摘要、原文件摘要和 unified diff。`Preview` 仅产生 Plan，绝不写盘。

## 6. 配置、模板与状态目录

```text
.codegen/
  config.json                         # 解决方案与默认 Profile
  schemas/
    profile.schema.json
    entity.schema.json
  profiles/
    iczp-ddd.json
    simple.json
    readonly.json
  entities/
    Article.codegen.json
  templates/
    iczp-ddd/
      dto.sbncs
      create-dto.sbncs
      app-service-base.sbncs
      ef-configuration-base.sbncs
  state/
    Article.state.json                 # 上次成功生成的指纹、输出清单和哈希
```

模板与 Profile 应置入 Git；`state/` 是否忽略由团队策略决定。建议提交状态文件以便 CI 检查“实体已变更但未重新生成”。模板参数使用受控 `GenerationModel`，禁止模板读取任意本机路径或执行外部命令。

## 7. 代码输出策略

为每种文件明确所有权，避免覆盖手写代码：

| 类型 | 推荐输出 | 写入策略 |
| --- | --- | --- |
| DTO / Input | `ArticleDto.g.cs` | 完全生成，可覆盖 |
| 应用服务基础类 | `ArticleAppServiceBase.g.cs` | 完全生成，可覆盖 |
| 应用服务扩展类 | `ArticleAppService.cs` | 仅首建，后续 Skip |
| 仓储基础类 | `EfCoreArticleRepositoryBase.g.cs` | 完全生成，可覆盖 |
| EF 基础配置 | `ArticleEntityTypeConfigurationBase.g.cs` | 完全生成，可覆盖 |
| EF 扩展配置 | `ArticleEntityTypeConfiguration.cs` | 仅首建，后续 Skip |
| DbContext / 权限 / 本地化 | Roslyn 定位的受控片段 | 精确更新；找不到锚点即 Conflict |

所有可覆盖文件必须带机器头，例如 `// <auto-generated />`，并由 state 记录上次哈希。若目标文件不是受管生成文件、哈希与预期不符，或 C# 锚点不唯一，计划必须为 `Conflict`，不得静默覆盖。

## 8. CLI 设计

```text
abpgen init [--solution <path>] [--profile iczp-ddd]
abpgen entities [--assembly <project>] [--namespace <ns>] [--json]
abpgen inspect <entity> [--json]
abpgen init-entity <entity> [--profile <name>]
abpgen validate [entity]
abpgen generate <entity> [--profile <name>] [--only dto,application] [--dry-run]
abpgen generate --all [--dry-run]
abpgen regenerate <entity>
abpgen ui [--port 5178] [--no-open]
```

- 默认从当前目录向上定位 `.sln` 与 `.codegen/config.json`；多解情况要求 `--solution`，不猜测。
- `inspect --json` 输出稳定、可被 AI 与 CI 消费的 `EntityModel`。
- `generate --dry-run` 与 UI Preview 共用同一 `CreatePlanAsync`，输出文件动作和 Diff，但不写盘。
- `--only` 只缩小本次输出范围，不改变 Descriptor 配置。
- 退出码建议：`0` 成功、`2` 参数/配置错误、`3` 发现 Conflict、`4` 验证/构建失败。

## 9. 本地 Web UI 与 API

`abpgen ui` 运行本地 Kestrel 并托管已构建的 Vue SPA；发布产物内含 `wwwroot`，使用者无需安装 Node.js。开发阶段允许 Vite 代理本地 API。

建议 API：

```text
GET  /api/project
GET  /api/entities
GET  /api/entities/{entity}
PUT  /api/entities/{entity}/descriptor
GET  /api/profiles
GET  /api/profiles/{name}
PUT  /api/profiles/{name}
POST /api/generation/plan
POST /api/generation/generate
POST /api/generation/validate
```

UI 信息架构：

```text
实体列表 → 实体编辑
            [基本] [字段] [查询] [生成文件] [预览]
```

- **实体列表**：显示 Domain 扫描结果、配置状态、实体指纹变更与冲突状态。
- **基本**：Profile、CRUD、权限、Repository/AppService 模式。
- **字段**：DTO/Create/Update/List/Detail 暴露、默认预设、验证覆盖。
- **查询**：按属性类型约束的 Filter（string: contains 等；DateTime/数字: range；enum/bool: equals）。
- **生成文件**：按层展示会生成、首建、跳过或冲突的文件。
- **预览**：统一展示 Create/Update/Skip/Conflict 及逐文件 Diff；仅点击“生成”才执行写盘。

模板管理可作为第二阶段 UI：Monaco 编辑器、模板树、选定实体实时渲染预览。第一期只需模板在文件系统中可编辑，并在 Web 中只读显示。

## 10. 端到端处理流程

```text
Article.cs
  → Roslyn SolutionScanner / EntityAnalyzer
  → EntityModel + Fingerprint
  → load Profile + Descriptor + Convention
  → GenerationModel
  → validate model / template / paths
  → GenerationPlan + Diff
  → (Preview: return only) | (Generate: guarded write)
  → dotnet format (optional) / dotnet build (optional)
  → update state on successful write and validation
```

`Fingerprint` 由稳定的实体结构计算，至少覆盖实体全名、基类、属性名、规范化类型、可空性和影响生成的标准标注。UI/CLI 检测到与 Descriptor/state 不一致时提示结构变化（新增、删除、类型变化），但仍可预览；写盘前必须将未匹配属性明确标识为错误或用户确认后的配置迁移结果。

## 11. 关键服务接口

```csharp
public interface IGenerationService
{
    Task<EntityAnalysisResult> AnalyzeEntityAsync(EntityReference entity, CancellationToken cancellationToken = default);
    Task<GenerationPlan> CreatePlanAsync(GenerationRequest request, CancellationToken cancellationToken = default);
    Task<GenerationPreview> PreviewAsync(GenerationRequest request, CancellationToken cancellationToken = default);
    Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default);
    Task<ValidationResult> ValidateAsync(ValidationRequest request, CancellationToken cancellationToken = default);
}
```

`GenerateAsync` 内部必须重新创建计划并验证环境，不能接受客户端传来的文件内容或路径作为可信写入指令。写入路径必须被限制在已识别项目根目录内。

## 12. 分期实施

### Phase 0：骨架与契约

建立 solution、分层项目、公共模型、JSON Schema、错误/冲突模型、模板渲染最小能力和测试基架。交付一个可载入 Profile/Descriptor 的 `GenerationModel` 合并器。

验收：同一组 EntityModel + Profile + Descriptor 总是产生确定性的 GenerationModel；配置 Schema 校验失败可读、可定位。

### Phase 1：Roslyn 分析 + CLI MVP

实现 `.sln` 定位、项目/实体枚举、ABP 基类识别、属性分析、`inspect --json`、`init`、`init-entity`。完成 DTO、Create DTO、Update DTO、List Input 四种只生成 `.g.cs` 的模板及 `--dry-run`。

验收：对样例 ABP Domain 项目可分析实体并预览文件；生成不修改任何非 auto-generated 文件。

### Phase 2：完整后端生成与受控修改

增加 Repository、AppService、EF Configuration、AutoMapper、Permission、Localization。实现基础类/扩展类模式、状态清单、哈希保护、Roslyn 受控修改、Diff、`validate` 与可选 `dotnet build`。

验收：再次生成幂等；手改生成文件和无法定位的锚点都会进入 Conflict；扩展文件不被覆盖。

### Phase 3：本地 Web UI

实现 Local Web Host、实体列表、Profile/Descriptor 编辑、字段/查询页、生成文件页与 Preview Diff。UI 使用与 CLI 相同的 API/service；引入端到端测试覆盖“保存配置 → 预览 → 生成”。

验收：用户无需 Node 就能通过 `abpgen ui` 配置一个实体并生成与 CLI 相同的结果。

### Phase 4：增强能力

加入模板可视化管理、字段预设、批量扫描、CI drift check、Vue/Vben/TypeScript Client 生成器、插件机制、IDE 与 Codex/MCP 适配器。团队中心化服务仅在确有跨仓库模板治理需求时再考虑。

## 13. 测试与质量门禁

- **Roslyn fixture tests**：实体继承、nullable、导航属性、ABP 审计、多租户、数据标注和常量长度推导。
- **Golden tests**：固定 GenerationModel 输入对比模板输出快照。
- **Plan tests**：新增、更新、跳过、冲突、路径越界、手改文件与重复执行。
- **Integration tests**：在临时 ABP 样例 solution 上执行 `init → inspect → preview → generate → build`。
- **API/UI tests**：Descriptor 保存后 CLI 与 UI 的计划一致；浏览器端至少覆盖配置、预览和生成结果。
- **CI**：格式化、单测、模板/Schema 校验、样例项目生成后的 Git diff 与 build；可选 `abpgen validate --all` 防止实体变更后生成物漂移。

## 14. 风险与决策

| 风险 | 决策 |
| --- | --- |
| Entity 变更导致配置失配 | Fingerprint + 属性 Diff；不自动猜测删除/重命名映射 |
| 重新生成覆盖业务修改 | `.g.cs`/Base/partial 分层、auto-generated 标记、state 哈希、Conflict 默认失败 |
| 不同 ABP 模块目录不统一 | Profile 中声明输出布局；SolutionScanner 先建立模块上下文 |
| 模板能力失控 | 模板只接收 GenerationModel；限定模板目录与输出目录；所有写盘经 Plan 守卫 |
| CLI 与 UI 行为漂移 | 入口只适配请求，计划/生成服务和契约测试共用 |
| Web Host 暴露源码修改能力 | 默认 loopback、明确项目根、无远程监听；所有写盘需 Plan 复核 |

## 15. 首个可用版本的建议范围

先选择一个结构最典型、依赖最少的 ABP 模块作为样例。MVP 只支持单实体、单 Profile、DTO/Input 与 AppService Base/扩展类，完整跑通：

```text
abpgen init
abpgen inspect Article --json
abpgen init-entity Article
abpgen generate Article --dry-run
abpgen generate Article
```

当输出所有权、Diff、冲突处理和再生成幂等性被证明可靠后，再扩展 EF、权限、DbContext 修改与 Web UI。这样可先把最危险的“改源码”能力做稳，而不是先完成界面后再处理生成安全性。
