using IczpNet.CodeGenerator.Core;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace IczpNet.CodeGenerator.Roslyn;

public sealed class EntityScanner
{
    private static readonly HashSet<string> SystemManagedProperties = new(StringComparer.Ordinal)
    {
        "CreationTime", "CreatorId", "LastModificationTime", "LastModifierId", "DeletionTime", "DeleterId",
        "IsDeleted", "ConcurrencyStamp", "ExtraProperties", "TenantId"
    };

    public static IReadOnlyList<EntityModel> Scan(string projectDirectory)
    {
        var root = Path.GetFullPath(projectDirectory);
        if (!Directory.Exists(root))
        {
            throw new DirectoryNotFoundException($"Project directory was not found: {root}");
        }

        return Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
            .SelectMany(ParseFile)
            .OrderBy(x => x.FullName, StringComparer.Ordinal)
            .ToArray();
    }

    private static IEnumerable<EntityModel> ParseFile(string path)
    {
        var root = CSharpSyntaxTree.ParseText(File.ReadAllText(path), path: path).GetCompilationUnitRoot();
        var namespaceName = root.Members.OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault()?.Name.ToString() ?? string.Empty;

        foreach (var type in root.DescendantNodes().OfType<ClassDeclarationSyntax>().Where(x => x.Modifiers.Any(SyntaxKind.PublicKeyword)))
        {
            var baseType = type.BaseList?.Types.FirstOrDefault()?.Type.ToString();
            if (!IsEntityBaseType(baseType))
            {
                continue;
            }

            var properties = type.Members.OfType<PropertyDeclarationSyntax>()
                .Where(x => x.Modifiers.Any(SyntaxKind.PublicKeyword))
                .Where(x => x.AccessorList?.Accessors.Any(a => a.IsKind(SyntaxKind.GetAccessorDeclaration)) == true)
                .Select(x => new EntityPropertyModel(
                    x.Identifier.Text,
                    x.Type.ToString(),
                    x.Type is NullableTypeSyntax || x.Type.ToString().EndsWith('?'),
                    SystemManagedProperties.Contains(x.Identifier.Text)))
                .ToArray();

            if (properties.Length == 0)
            {
                continue;
            }

            var keyType = ResolveKeyType(baseType);
            var fullName = string.IsNullOrWhiteSpace(namespaceName) ? type.Identifier.Text : $"{namespaceName}.{type.Identifier.Text}";
            yield return new EntityModel(type.Identifier.Text, namespaceName, baseType, keyType, properties,
                EntityFingerprint.Create(fullName, baseType, properties));
        }
    }

    private static string ResolveKeyType(string? baseType)
    {
        if (string.IsNullOrWhiteSpace(baseType)) return "Guid";
        var generic = SyntaxFactory.ParseTypeName(baseType).DescendantNodesAndSelf().OfType<GenericNameSyntax>().FirstOrDefault();
        return generic?.TypeArgumentList.Arguments.FirstOrDefault()?.ToString() ?? "Guid";
    }

    private static bool IsEntityBaseType(string? baseType)
        => !string.IsNullOrWhiteSpace(baseType) &&
           (baseType.Contains("AggregateRoot", StringComparison.Ordinal) ||
            baseType.Contains("Entity", StringComparison.Ordinal));
}
