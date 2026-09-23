using System.Security.Cryptography;
using System.Text;

namespace IczpNet.CodeGenerator.Core;

public sealed record EntityPropertyModel(
    string Name,
    string TypeName,
    bool IsNullable,
    bool IsSystemManaged);

public sealed record EntityModel(
    string Name,
    string Namespace,
    string? BaseType,
    string KeyType,
    IReadOnlyList<EntityPropertyModel> Properties,
    string Fingerprint)
{
    public string FullName => string.IsNullOrWhiteSpace(Namespace) ? Name : $"{Namespace}.{Name}";
}

public sealed class EntityDescriptor
{
    public string Entity { get; init; } = string.Empty;
    public string Profile { get; init; } = "iczp-ddd";
    public CrudDescriptor Crud { get; init; } = new();
    public PermissionDescriptor Permissions { get; init; } = new();
    public string DefaultSorting { get; init; } = "CreationTime desc";
    public EntityConstructionDescriptor? Construction { get; init; }
    public EntityUpdateDescriptor? Update { get; init; }
    public Dictionary<string, PropertyDescriptor> Properties { get; init; } = new(StringComparer.Ordinal);
}

public sealed class CrudDescriptor { public bool Get { get; init; } = true; public bool GetList { get; init; } = true; public bool Create { get; init; } = true; public bool Update { get; init; } = true; public bool Delete { get; init; } = true; }
public sealed class PermissionDescriptor { public bool Enabled { get; init; } = true; }
public sealed class EntityConstructionDescriptor { public List<string> Parameters { get; init; } = []; }
public sealed class EntityUpdateDescriptor { public string Method { get; init; } = string.Empty; public List<string> Parameters { get; init; } = []; }

public sealed class PropertyDescriptor
{
    public string? DisplayName { get; init; }
    public string? Description { get; init; }
    public bool? Required { get; init; }
    public int? MaxLength { get; init; }
    public string? DefaultValue { get; init; }
    public bool? Dto { get; init; }
    public bool? Create { get; init; }
    public bool? Update { get; init; }
    public string? Filter { get; init; }
    public bool? Sortable { get; init; }
}

public enum PlannedFileAction { Create, Update, Skip, Conflict }

public sealed record PlannedFile(string Path, PlannedFileAction Action, string Content, string? CurrentContent, string? Diff);

public sealed record GenerationPlan(IReadOnlyList<PlannedFile> Files)
{
    public bool HasConflicts => Files.Any(x => x.Action == PlannedFileAction.Conflict);
}

public static class EntityFingerprint
{
    public static string Create(string fullName, string? baseType, IEnumerable<EntityPropertyModel> properties)
    {
        var material = new StringBuilder(fullName).Append('|').Append(baseType);
        foreach (var property in properties.OrderBy(x => x.Name, StringComparer.Ordinal))
        {
            material.Append('|').Append(property.Name).Append(':').Append(property.TypeName)
                .Append(':').Append(property.IsNullable).Append(':').Append(property.IsSystemManaged);
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material.ToString())));
    }
}
