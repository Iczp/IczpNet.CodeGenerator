using System.Globalization;

namespace IczpNet.CodeGenerator.Core;

public static class DescriptorValidator
{
    public static IReadOnlyList<string> Validate(EntityModel entity, EntityDescriptor descriptor)
    {
        var errors = new List<string>();
        foreach (var property in entity.Properties)
        {
            if (!descriptor.Properties.TryGetValue(property.Name, out var setting) || string.IsNullOrWhiteSpace(setting.DefaultValue)) continue;
            var value = setting.DefaultValue.Trim();
            var type = property.TypeName.TrimEnd('?');
            if (value.Equals("null", StringComparison.OrdinalIgnoreCase))
            {
                if (!property.IsNullable) errors.Add($"{property.Name}: null is only valid for nullable properties.");
                continue;
            }
            var valid = type switch
            {
                "string" => true,
                "bool" => bool.TryParse(value, out _),
                "Guid" => Guid.TryParse(value, out _),
                "DateTime" => DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _),
                "DateTimeOffset" => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _),
                "byte" => byte.TryParse(value, CultureInfo.InvariantCulture, out _),
                "short" => short.TryParse(value, CultureInfo.InvariantCulture, out _),
                "int" => int.TryParse(value, CultureInfo.InvariantCulture, out _),
                "long" => long.TryParse(value, CultureInfo.InvariantCulture, out _),
                "float" => float.TryParse(value, CultureInfo.InvariantCulture, out _),
                "double" => double.TryParse(value, CultureInfo.InvariantCulture, out _),
                "decimal" => decimal.TryParse(value, CultureInfo.InvariantCulture, out _),
                _ => IsEnumLike(value)
            };
            if (!valid) errors.Add($"{property.Name}: '{value}' is not a valid {type} default value.");
        }
        return errors;
    }

    private static bool IsEnumLike(string value) => value.All(character => char.IsLetterOrDigit(character) || character == '_');
}
