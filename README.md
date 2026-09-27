# IczpNet Code Generator

Entity-First ABP vNext code generator. The generator lives in this repository; target applications (including `IczpNet.Cms`) supply the domain entities it analyzes and the generated output it validates.

## Current MVP

- Roslyn syntax analysis for ABP-style entities inheriting an `Entity` or `AggregateRoot` base type.
- Stable `EntityModel` JSON output and structural fingerprint.
- `.codegen` initialization plus per-entity descriptor initialization.
- ABP Domain, Contracts, Application and EF Core output plans, including CRUD, permissions, mapping and DbContext anchors.
- YAML/JSON descriptors, guarded overwrite, conflict handling, preview and Diff.
- Local Web UI for entity metadata, descriptor editing, planning, generation and validation logs.

## Run

```powershell
dotnet build .\IczpNet.CodeGenerator.sln

dotnet run --project .\src\IczpNet.CodeGenerator.Cli -- entities --project F:\Dev\abpvnext\IczpNet.Cms\aspnet-core\src\IczpNet.Cms.Domain
dotnet run --project .\src\IczpNet.CodeGenerator.Cli -- generate Article --project F:\Dev\abpvnext\IczpNet.Cms\aspnet-core\src\IczpNet.Cms.Domain --dry-run
dotnet run --project .\src\IczpNet.CodeGenerator.Cli -- validate Article --project F:\Dev\abpvnext\IczpNet.Cms\aspnet-core\src\IczpNet.Cms.Domain
dotnet run --project .\src\IczpNet.CodeGenerator.Cli -- ui --project F:\Dev\abpvnext\IczpNet.Cms\aspnet-core\src\IczpNet.Cms.Domain
```

Use the Web UI to edit `.codegen/entities/<Entity>.codegen.yaml` or `.json`; entity source files are read-only. `generate` first applies the entire plan to an isolated copy and builds the generated Contracts, Application, and EF Core projects. If validation fails, no generated file is written to the target. Before writing, it preflights the entire batch and refuses unresolved conflicts or files changed since planning. Writes use a persistent transaction journal; if a process is interrupted, run `abpgen recover --project <solution-root>` before generating again. Explicit UI keep/overwrite decisions remain available for conflicts.

The local CMS acceptance fixture includes `Article` (Guid key, full CRUD and permissions) and `CatalogEntry` (int key, enum and nullable properties, restricted CRUD and disabled permissions). Run `scripts/verify-cms-integration.ps1 -CmsDomain <path-to-IczpNet.Cms.Domain>` to validate both without writing generated files to CMS.

The current template engine covers DTO output only. Full template migration and browser E2E tests remain follow-up work after the isolated-build and safe-write closure.

## Verification

```powershell
dotnet test .\IczpNet.CodeGenerator.sln
pnpm --dir .\ui\IczpNet.CodeGenerator.WebUi build
```
