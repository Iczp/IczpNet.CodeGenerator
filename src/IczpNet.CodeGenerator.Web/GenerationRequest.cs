namespace IczpNet.CodeGenerator.Web;

public sealed record GenerationRequest(
    string Entity,
    string? Project = null,
    IReadOnlyList<string>? IgnoredPaths = null,
    IReadOnlyList<string>? OverwritePaths = null);
