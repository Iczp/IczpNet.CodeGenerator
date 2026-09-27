using IczpNet.CodeGenerator.Core;

namespace IczpNet.CodeGenerator.Web;

public sealed record DescriptorUpdateRequest(EntityDescriptor Descriptor, string? Format);

public sealed record RawDescriptorUpdateRequest(string Content, string? Format);

public sealed record ExecutionResult(bool Succeeded, IReadOnlyList<string> Logs, GenerationPlan Plan);
