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
                .Select(CreatePropertyModel)
                .ToArray();

            if (properties.Length == 0)
            {
                continue;
            }

            var keyType = ResolveKeyType(baseType);
            var fullName = string.IsNullOrWhiteSpace(namespaceName) ? type.Identifier.Text : $"{namespaceName}.{type.Identifier.Text}";
            yield return new EntityModel(type.Identifier.Text, namespaceName, baseType, keyType, properties,
                EntityFingerprint.Create(fullName, baseType, properties),
                type.Members.OfType<ConstructorDeclarationSyntax>().Select(CreateConstructorModel).ToArray(),
                type.Members.OfType<MethodDeclarationSyntax>().Where(IsDomainMethod).Select(CreateMethodModel).ToArray());
        }
    }

    private static EntityPropertyModel CreatePropertyModel(PropertyDeclarationSyntax property)
    {
        var attributes = property.AttributeLists.SelectMany(x => x.Attributes).ToArray();
        var typeName = property.Type.ToString();
        var constraints = new EntityPropertyConstraints(
            IsRequired: HasAttribute(attributes, "Required"),
            MaxLength: IntegerAttributeArgument(attributes, "MaxLength"),
            StringLength: IntegerAttributeArgument(attributes, "StringLength"),
            RangeMinimum: StringAttributeArgument(attributes, "Range", 0),
            RangeMaximum: StringAttributeArgument(attributes, "Range", 1),
            RegularExpression: StringAttributeArgument(attributes, "RegularExpression"),
            DefaultValue: StringAttributeArgument(attributes, "DefaultValue"));
        var hasConstraints = constraints != new EntityPropertyConstraints();
        return new EntityPropertyModel(
            property.Identifier.Text,
            typeName,
            property.Type is NullableTypeSyntax || typeName.EndsWith('?'),
            SystemManagedProperties.Contains(property.Identifier.Text),
            Documentation(property),
            hasConstraints ? constraints : null,
            property.AccessorList?.Accessors.Any(x => x.IsKind(SyntaxKind.SetAccessorDeclaration) && x.Modifiers.Count == 0) == true,
            IsCollection(typeName));
    }

    private static EntityConstructorModel CreateConstructorModel(ConstructorDeclarationSyntax constructor)
        => new(
            constructor.Modifiers.Any(SyntaxKind.PublicKeyword),
            constructor.ParameterList.Parameters.Select(CreateParameterModel).ToArray());

    private static EntityMethodModel CreateMethodModel(MethodDeclarationSyntax method)
        => new(
            method.Identifier.Text,
            method.Modifiers.Any(SyntaxKind.PublicKeyword),
            method.ParameterList.Parameters.Select(CreateParameterModel).ToArray());

    private static EntityConstructorParameter CreateParameterModel(ParameterSyntax parameter)
    {
        var typeName = parameter.Type?.ToString() ?? "object";
        return new EntityConstructorParameter(parameter.Identifier.Text, typeName,
            parameter.Type is NullableTypeSyntax || typeName.EndsWith('?'));
    }

    private static bool IsDomainMethod(MethodDeclarationSyntax method)
        => method.Modifiers.Any(SyntaxKind.PublicKeyword)
            && !method.Modifiers.Any(SyntaxKind.StaticKeyword)
            && method.ReturnType is PredefinedTypeSyntax predefined
            && predefined.Keyword.IsKind(SyntaxKind.VoidKeyword);

    private static bool HasAttribute(IEnumerable<AttributeSyntax> attributes, string name)
        => attributes.Any(attribute => AttributeName(attribute) == name);

    private static int? IntegerAttributeArgument(IEnumerable<AttributeSyntax> attributes, string name)
    {
        var value = StringAttributeArgument(attributes, name);
        return int.TryParse(value, out var parsed) ? parsed : null;
    }

    private static string? StringAttributeArgument(IEnumerable<AttributeSyntax> attributes, string name, int position = 0)
    {
        var attribute = attributes.FirstOrDefault(candidate => AttributeName(candidate) == name);
        var argument = attribute?.ArgumentList?.Arguments.ElementAtOrDefault(position)?.Expression;
        return argument switch
        {
            LiteralExpressionSyntax literal => literal.Token.ValueText,
            _ => argument?.ToString()
        };
    }

    private static string AttributeName(AttributeSyntax attribute)
    {
        var name = attribute.Name.ToString().Split('.').Last();
        return name.EndsWith("Attribute", StringComparison.Ordinal) ? name[..^"Attribute".Length] : name;
    }

    private static string? Documentation(MemberDeclarationSyntax member)
    {
        var documentation = member.GetLeadingTrivia()
            .Select(trivia => trivia.GetStructure())
            .OfType<DocumentationCommentTriviaSyntax>()
            .FirstOrDefault();
        if (documentation is null) return null;
        var summary = documentation.Content.OfType<XmlElementSyntax>()
            .FirstOrDefault(element => element.StartTag.Name.LocalName.Text == "summary");
        var text = (summary?.Content ?? documentation.Content).ToFullString().Trim();
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private static bool IsCollection(string typeName)
        => typeName.StartsWith("ICollection<", StringComparison.Ordinal)
            || typeName.StartsWith("IReadOnlyCollection<", StringComparison.Ordinal)
            || typeName.StartsWith("IEnumerable<", StringComparison.Ordinal)
            || typeName.StartsWith("List<", StringComparison.Ordinal)
            || typeName.EndsWith("[]", StringComparison.Ordinal);

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
