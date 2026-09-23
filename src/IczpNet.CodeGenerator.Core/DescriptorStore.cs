using System.Text.Json;
using System.Text.Json.Nodes;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace IczpNet.CodeGenerator.Core;

public static class DescriptorStore
{
    public sealed record DescriptorDocument(EntityDescriptor? Descriptor, string Format, string Path);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static readonly IDeserializer YamlDeserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .IgnoreUnmatchedProperties()
        .Build();

    private static readonly ISerializer YamlSerializer = new SerializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
        .Build();

    public static EntityDescriptor? Load(string projectRoot, string entityName)
        => LoadDocument(projectRoot, entityName).Descriptor;

    public static DescriptorDocument LoadDocument(string projectRoot, string entityName)
    {
        var paths = new[]
        {
            Path.Combine(projectRoot, ".codegen", "entities", $"{entityName}.codegen.json"),
            Path.Combine(projectRoot, ".codegen", "entities", $"{entityName}.codegen.yaml"),
            Path.Combine(projectRoot, ".codegen", "entities", $"{entityName}.codegen.yml")
        }.Where(File.Exists).ToArray();
        if (paths.Length == 0)
        {
            var path = Path.Combine(projectRoot, ".codegen", "entities", $"{entityName}.codegen.yaml");
            return new DescriptorDocument(null, "yaml", path);
        }
        if (paths.Length > 1) throw new InvalidOperationException($"Only one descriptor format is allowed for {entityName}: {string.Join(", ", paths)}");

        var text = File.ReadAllText(paths[0]);
        var format = paths[0].EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? "json" : "yaml";
        var descriptor = Parse(text, format);
        return new DescriptorDocument(descriptor ?? throw new InvalidOperationException($"Descriptor '{paths[0]}' is empty or invalid."), format, paths[0]);
    }

    public static void Save(string projectRoot, EntityDescriptor descriptor, string format)
    {
        var extension = format.Equals("yaml", StringComparison.OrdinalIgnoreCase) ? "yaml" : "json";
        var directory = Path.Combine(projectRoot, ".codegen", "entities");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"{LastSegment(descriptor.Entity)}.codegen.{extension}");
        if (File.Exists(path)) return;
        var content = Serialize(descriptor, extension);
        File.WriteAllText(path, content);
    }

    public static void SaveDocument(DescriptorDocument document, EntityDescriptor descriptor, string format)
    {
        var normalizedFormat = format.Equals("json", StringComparison.OrdinalIgnoreCase) ? "json" : "yaml";
        var extension = normalizedFormat == "json" ? "json" : "yaml";
        if (document.Descriptor is not null && !string.Equals(document.Format, normalizedFormat, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Changing descriptor format is not supported while a descriptor already exists. Keep its current format.");

        var expectedPath = document.Descriptor is null ? Path.ChangeExtension(document.Path, extension) : document.Path;

        Directory.CreateDirectory(Path.GetDirectoryName(expectedPath)!);
        var content = document.Descriptor is null ? Serialize(descriptor, normalizedFormat) : MergeStructuredContent(File.ReadAllText(document.Path), Serialize(descriptor, normalizedFormat), normalizedFormat);
        File.WriteAllText(expectedPath, content);
    }

    public static void SaveRawDocument(DescriptorDocument document, string content, string format)
    {
        var normalizedFormat = format.Equals("json", StringComparison.OrdinalIgnoreCase) ? "json" : "yaml";
        if (document.Descriptor is not null && !string.Equals(document.Format, normalizedFormat, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Changing descriptor format is not supported while a descriptor already exists. Keep its current format.");

        var path = document.Descriptor is null
            ? Path.ChangeExtension(document.Path, normalizedFormat == "json" ? "json" : "yaml")
            : document.Path;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    public static EntityDescriptor? Parse(string content, string format)
        => format.Equals("json", StringComparison.OrdinalIgnoreCase)
            ? JsonSerializer.Deserialize<EntityDescriptor>(content, JsonOptions)
            : YamlDeserializer.Deserialize<EntityDescriptor>(content);

    public static string Serialize(EntityDescriptor descriptor, string format)
        => format.Equals("json", StringComparison.OrdinalIgnoreCase)
            ? JsonSerializer.Serialize(descriptor, JsonOptions)
            : YamlSerializer.Serialize(descriptor);

    public static string MergeStructuredContent(string current, string generated, string format)
    {
        if (!format.Equals("json", StringComparison.OrdinalIgnoreCase)) return MergeYaml(current, generated);
        var target = JsonNode.Parse(current) as JsonObject ?? throw new InvalidOperationException("Descriptor JSON must be an object.");
        var source = JsonNode.Parse(generated) as JsonObject ?? throw new InvalidOperationException("Generated descriptor JSON must be an object.");
        MergeJson(target, source);
        return target.ToJsonString(JsonOptions);
    }

    private static void MergeJson(JsonObject target, JsonObject source)
    {
        foreach (var (key, value) in source)
        {
            if (value is JsonObject sourceObject && target[key] is JsonObject targetObject) MergeJson(targetObject, sourceObject);
            else target[key] = value?.DeepClone();
        }
    }

    private static string MergeYaml(string current, string generated)
    {
        var existing = YamlDeserializer.Deserialize<Dictionary<string, object>>(current) ?? [];
        var incoming = YamlDeserializer.Deserialize<Dictionary<string, object>>(generated) ?? [];
        MergeYamlMaps(existing, incoming);
        return YamlSerializer.Serialize(existing);
    }

    private static void MergeYamlMaps(Dictionary<string, object> target, Dictionary<string, object> source)
    {
        foreach (var (key, value) in source)
        {
            if (value is IDictionary<object, object> sourceMap && target.TryGetValue(key, out var current) && current is IDictionary<object, object> targetMap)
            {
                var sourceStringMap = sourceMap.ToDictionary(x => x.Key.ToString()!, x => x.Value);
                var targetStringMap = targetMap.ToDictionary(x => x.Key.ToString()!, x => x.Value);
                MergeYamlMaps(targetStringMap, sourceStringMap);
                target[key] = targetStringMap;
            }
            else target[key] = value;
        }
    }

    private static string LastSegment(string entity) => entity.Split('.').Last();
}
