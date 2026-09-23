# Workspace Responsibilities

- `F:\Dev\abpvnext\IczpNet.CodeGenerator` is the code generator's primary repository. Keep the generator engine, CLI, local Web UI, templates, profiles, schemas, tests, and generator documentation here.
- `F:\Dev\abpvnext\IczpNet.Cms` is the target application workspace whose ABP backend is under `F:\Dev\abpvnext\IczpNet.Cms\aspnet-core`. Treat it as the reference/sample target when analyzing entities, validating generated output, and running integration tests. The CMS root is intentionally reserved for sibling frontend/UI projects; do not move the ABP backend contents into the CMS root.

## Working Rule

Implement generator capabilities in `IczpNet.CodeGenerator`. Only modify `IczpNet.Cms` when the task explicitly requires adding or regenerating target application code, fixtures, or integration-test assets. Preserve manually maintained CMS code; generated files must follow the generator's ownership and overwrite safeguards. Keep backend-specific files within `IczpNet.Cms\aspnet-core`.
