using System.Text;
using System.Globalization;

namespace IczpNet.CodeGenerator.Core;

public sealed class GenerationService
{
    public static GenerationPlan CreateDtoPlan(EntityModel entity, AbpProjectLayout layout, EntityDescriptor? descriptor = null)
    {
        EnsureProfile(layout, descriptor);
        var fields = entity.Properties.Where(x => !x.IsSystemManaged).ToArray();
        var dto = RenderDto(entity, $"{entity.Name}Dto", fields, descriptor, _ => true);
        var create = RenderDto(entity, $"{entity.Name}CreateInput", fields, descriptor, p => IsEnabled(descriptor, p.Name, x => x.Create, true));
        var update = RenderDto(entity, $"{entity.Name}UpdateInput", fields, descriptor, p => IsEnabled(descriptor, p.Name, x => x.Update, true));
        var list = RenderListInput(entity, fields, descriptor);

        return new GenerationPlan([
            Plan(layout, $"{entity.Name}Dto.g.cs", dto),
            Plan(layout, $"{entity.Name}CreateInput.g.cs", create),
            Plan(layout, $"{entity.Name}UpdateInput.g.cs", update),
            Plan(layout, $"{entity.Name}GetListInput.g.cs", list),
            Plan(layout.DomainProject, layout.FeatureFolder, $"I{entity.Name}Repository.g.cs", RenderRepositoryInterface(entity)),
            Plan(layout.ContractsProject, layout.FeatureFolder, $"I{entity.Name}AppService.g.cs", RenderAppServiceInterface(entity, descriptor)),
            Plan(layout.ApplicationProject, layout.FeatureFolder, $"{entity.Name}AppServiceBase.g.cs", RenderAppServiceBase(entity, descriptor)),
            PlanExtension(layout.ApplicationProject, layout.FeatureFolder, $"{entity.Name}AppService.cs", RenderAppService(entity)),
            Plan(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}RepositoryBase.g.cs", RenderRepositoryBase(entity)),
            PlanExtension(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}Repository.cs", RenderRepository(entity)),
            Plan(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}EntityTypeConfigurationBase.g.cs", RenderEfConfigurationBase(entity, descriptor)),
            PlanExtension(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}EntityTypeConfiguration.cs", RenderEfConfiguration(entity)),
            PlanDbContext(layout, entity),
            Plan(layout.ContractsProject, "Permissions", $"{entity.Name}Permissions.g.cs", RenderPermissions(entity, descriptor)),
            Plan(layout.ContractsProject, "Permissions", $"{entity.Name}PermissionDefinitionProvider.g.cs", RenderPermissionProvider(entity, descriptor)),
            Plan(layout.ApplicationProject, layout.FeatureFolder, $"{entity.Name}Mapper.g.cs", RenderMapper(entity, descriptor))
        ]);
    }

    private static bool IsEnabled(EntityDescriptor? descriptor, string name, Func<PropertyDescriptor, bool?> getValue, bool defaultValue)
        => descriptor?.Properties.TryGetValue(name, out var setting) == true ? getValue(setting) ?? defaultValue : defaultValue;

    private static void EnsureProfile(AbpProjectLayout layout, EntityDescriptor? descriptor)
    {
        if (descriptor is null || layout.AbpProfile is null || string.Equals(descriptor.Profile, layout.AbpProfile.Name, StringComparison.Ordinal)) return;
        throw new InvalidOperationException($"Descriptor profile '{descriptor.Profile}' is incompatible with target ABP profile '{layout.AbpProfile.Name}'.");
    }

    private static string RenderDto(EntityModel entity, string dtoName, IEnumerable<EntityPropertyModel> properties, EntityDescriptor? descriptor, Func<EntityPropertyModel, bool> include)
    {
        var sb = Header(entity.Namespace).AppendLine("using System.ComponentModel;").AppendLine("using System.ComponentModel.DataAnnotations;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public sealed class {dtoName}").AppendLine("{");
        var templateProperties = new List<object>();
        foreach (var property in properties.Where(x => include(x) && IsEnabled(descriptor, x.Name, setting => setting.Dto, true)))
        {
            PropertyDescriptor? setting = null;
            descriptor?.Properties.TryGetValue(property.Name, out setting);
            var metadata = new StringBuilder();
            AppendPropertyMetadata(metadata, property, setting);
            templateProperties.Add(new { name = property.Name, type_name = property.TypeName, metadata = metadata.ToString(), initializer = PropertyInitializer(property, setting) });
            sb.Append(metadata).AppendLine(CultureInfo.InvariantCulture, $"    public {property.TypeName} {property.Name} {{ get; set; }}{PropertyInitializer(property, setting)}");
        }
        var fallback = sb.AppendLine("}").ToString();
        return TemplateRenderer.Render("dto.sbn", new { namespace_name = entity.Namespace, dto_name = dtoName, properties = templateProperties }, fallback);
    }

    private static void AppendPropertyMetadata(StringBuilder sb, EntityPropertyModel property, PropertyDescriptor? setting)
    {
        var description = setting?.Description ?? property.Documentation;
        var displayName = setting?.DisplayName;
        var required = setting?.Required ?? property.Constraints?.IsRequired ?? false;
        var maxLength = setting?.MaxLength ?? property.Constraints?.MaxLength ?? property.Constraints?.StringLength;
        var defaultValue = setting?.DefaultValue ?? property.Constraints?.DefaultValue;
        if (!string.IsNullOrWhiteSpace(description))
        {
            sb.AppendLine("    /// <summary>").AppendLine(CultureInfo.InvariantCulture, $"    /// {XmlEscape(description)}")
                .AppendLine("    /// </summary>");
        }

        if (!string.IsNullOrWhiteSpace(displayName) || !string.IsNullOrWhiteSpace(description))
        {
            var arguments = new List<string>();
            if (!string.IsNullOrWhiteSpace(displayName)) arguments.Add($"Name = {StringLiteral(displayName)}");
            if (!string.IsNullOrWhiteSpace(description)) arguments.Add($"Description = {StringLiteral(description)}");
            sb.AppendLine(CultureInfo.InvariantCulture, $"    [Display({string.Join(", ", arguments)})]");
        }

        if (required) sb.AppendLine("    [Required]");
        if (maxLength is > 0) sb.AppendLine(CultureInfo.InvariantCulture, $"    [StringLength({maxLength.Value})]");
        if (!string.IsNullOrWhiteSpace(defaultValue)) sb.AppendLine(CultureInfo.InvariantCulture, $"    [DefaultValue({StringLiteral(defaultValue)})]");
    }

    private static string PropertyInitializer(EntityPropertyModel property, PropertyDescriptor? setting)
    {
        var defaultValue = setting?.DefaultValue ?? property.Constraints?.DefaultValue;
        if (string.IsNullOrWhiteSpace(defaultValue)) return " = default!;";
        var value = defaultValue.Trim();
        var type = property.TypeName.TrimEnd('?');
        if (type == "string") return $" = {StringLiteral(value)};";
        if (type == "bool" && bool.TryParse(value, out var boolean)) return $" = {boolean.ToString().ToLowerInvariant()};";
        if (type == "Guid" && Guid.TryParse(value, out _)) return $" = Guid.Parse({StringLiteral(value)});";
        if (type is "byte" or "short" or "int" or "long" or "float" or "double" or "decimal" && decimal.TryParse(value, CultureInfo.InvariantCulture, out _)) return $" = {value};";
        return " = default!;";
    }

    private static string StringLiteral(string value) => $"\"{value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal)}\"";

    private static string XmlEscape(string value) => value.Replace("&", "&amp;", StringComparison.Ordinal).Replace("<", "&lt;", StringComparison.Ordinal).Replace(">", "&gt;", StringComparison.Ordinal);

    private static string RenderListInput(EntityModel entity, IEnumerable<EntityPropertyModel> properties, EntityDescriptor? descriptor)
    {
        var sb = Header(entity.Namespace).AppendLine(CultureInfo.InvariantCulture, $"public sealed class {entity.Name}GetListInput").AppendLine("{");
        foreach (var property in properties)
        {
            var filter = descriptor?.Properties.TryGetValue(property.Name, out var setting) == true
                ? setting.Filter
                : DefaultFilter(property.TypeName);
            if (string.Equals(filter, "range", StringComparison.OrdinalIgnoreCase))
            {
                var inputType = FilterInputType(property.TypeName);
                sb.AppendLine(CultureInfo.InvariantCulture, $"    public {inputType} {property.Name}Min {{ get; set; }}");
                sb.AppendLine(CultureInfo.InvariantCulture, $"    public {inputType} {property.Name}Max {{ get; set; }}");
            }
            else if (!string.IsNullOrWhiteSpace(filter) && !string.Equals(filter, "none", StringComparison.OrdinalIgnoreCase))
            {
                sb.AppendLine(CultureInfo.InvariantCulture, $"    public {FilterInputType(property.TypeName)} {property.Name} {{ get; set; }}");
            }
        }

        sb.AppendLine("    public int SkipCount { get; set; }");
        sb.AppendLine("    public int MaxResultCount { get; set; } = 10;");
        sb.AppendLine(CultureInfo.InvariantCulture, $"    public string Sorting {{ get; set; }} = {StringLiteral(descriptor?.DefaultSorting ?? "CreationTime desc")};");

        return sb.AppendLine("}").ToString();
    }

    private static StringBuilder Header(string entityNamespace)
        => new StringBuilder("// <auto-generated />\n#nullable enable\n\nusing System;\n\n")
            .AppendLine(CultureInfo.InvariantCulture, $"namespace {entityNamespace};").AppendLine();

    private static string? DefaultFilter(string typeName)
    {
        var plain = typeName.TrimEnd('?');
        return plain switch
        {
            "string" => "contains",
            "DateTime" or "DateTimeOffset" or "decimal" or "double" or "float" or "int" or "long" or "short" => "range",
            "bool" or "Guid" => "equals",
            _ => null
        };
    }

    private static string FilterInputType(string typeName)
    {
        var plain = typeName.TrimEnd('?');
        return plain switch
        {
            "string" => "string?",
            "DateTime" or "DateTimeOffset" or "decimal" or "double" or "float" or "int" or "long" or "short" or "bool" or "Guid" => $"{plain}?",
            _ => $"{plain}?"
        };
    }

    private static string RenderFilters(EntityModel entity, EntityDescriptor? descriptor)
    {
        var lines = new List<string>();
        foreach (var property in entity.Properties.Where(x => !x.IsSystemManaged))
        {
            var filter = descriptor?.Properties.TryGetValue(property.Name, out var setting) == true ? setting.Filter : DefaultFilter(property.TypeName);
            if (string.Equals(filter, "contains", StringComparison.OrdinalIgnoreCase))
                lines.Add($"        if (!string.IsNullOrWhiteSpace(input.{property.Name})) query = query.Where(x => x.{property.Name}.Contains(input.{property.Name}!));");
            else if (string.Equals(filter, "equals", StringComparison.OrdinalIgnoreCase))
                lines.Add($"        if (input.{property.Name}.HasValue) query = query.Where(x => x.{property.Name} == input.{property.Name}.Value);");
            else if (string.Equals(filter, "range", StringComparison.OrdinalIgnoreCase))
            {
                var prefix = property.IsNullable ? $"x.{property.Name}.HasValue && x.{property.Name}.Value" : $"x.{property.Name}";
                lines.Add($"        if (input.{property.Name}Min.HasValue) query = query.Where(x => {prefix} >= input.{property.Name}Min.Value);");
                lines.Add($"        if (input.{property.Name}Max.HasValue) query = query.Where(x => {prefix} <= input.{property.Name}Max.Value);");
            }
        }
        return string.Join(Environment.NewLine, lines);
    }

    private static string RenderSorting(EntityModel entity, EntityDescriptor? descriptor)
    {
        var hasCreationTime = entity.BaseType?.Contains("Audited", StringComparison.Ordinal) == true ||
            entity.Properties.Any(property => property.Name == "CreationTime");
        var allowed = entity.Properties.Where(property => IsEnabled(descriptor, property.Name, setting => setting.Sortable, false))
            .Select(property => property.Name).Concat(hasCreationTime ? ["CreationTime"] : [])
            .Distinct(StringComparer.Ordinal).ToArray();
        var lines = new List<string>();
        foreach (var property in allowed)
        {
            lines.Add($"            \"{property} asc\" => query.OrderBy(x => x.{property}),");
            lines.Add($"            \"{property} desc\" => query.OrderByDescending(x => x.{property}),");
        }
        var defaultSorting = descriptor?.DefaultSorting ?? (hasCreationTime ? "CreationTime desc" : $"{allowed.FirstOrDefault() ?? throw new InvalidOperationException($"{entity.Name} has no sortable property.")} asc");
        if (!allowed.Any(property => string.Equals(defaultSorting, $"{property} asc", StringComparison.Ordinal) || string.Equals(defaultSorting, $"{property} desc", StringComparison.Ordinal)))
            throw new InvalidOperationException($"Unsupported default sorting '{defaultSorting}' for {entity.Name}.");
        var parts = defaultSorting.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var fallback = parts[1] == "desc" ? $"query.OrderByDescending(x => x.{parts[0]})" : $"query.OrderBy(x => x.{parts[0]})";
        return $"        var sorted = input.Sorting switch\n        {{\n{string.Join("\n", lines)}\n            _ => {fallback}\n        }};";
    }

    private static PlannedFile Plan(AbpProjectLayout layout, string fileName, string content)
        => Plan(layout.ContractsProject, layout.FeatureFolder, fileName, content);

    private static PlannedFile Plan(string project, string featureFolder, string fileName, string content)
    {
        var path = Path.Combine(project, featureFolder, fileName);
        if (!File.Exists(path)) return new PlannedFile(path, PlannedFileAction.Create, content, null, null);
        var current = File.ReadAllText(path);
        if (string.Equals(current, content, StringComparison.Ordinal)) return new PlannedFile(path, PlannedFileAction.Skip, content, current, null);
        if (!current.StartsWith("// <auto-generated />", StringComparison.Ordinal))
            return new PlannedFile(path, PlannedFileAction.Conflict, content, current, "Target is not an auto-generated file.");
        return new PlannedFile(path, PlannedFileAction.Update, content, current, SimpleDiff(current, content));
    }

    private static PlannedFile PlanExtension(string project, string featureFolder, string fileName, string content)
    {
        var path = Path.Combine(project, featureFolder, fileName);
        return File.Exists(path)
            ? new PlannedFile(path, PlannedFileAction.Skip, content, File.ReadAllText(path), null)
            : new PlannedFile(path, PlannedFileAction.Create, content, null, null);
    }

    private static PlannedFile PlanDbContext(AbpProjectLayout layout, EntityModel entity)
    {
        var path = Directory.EnumerateFiles(layout.EntityFrameworkCoreProject, "*DbContext.cs", SearchOption.AllDirectories)
            .SingleOrDefault(x => !Path.GetFileName(x).Contains("Factory", StringComparison.Ordinal)
                && !Path.GetFileName(x).StartsWith('I'))
            ?? throw new InvalidOperationException("A single EF Core DbContext source file is required.");
        var current = File.ReadAllText(path);
        var marker = $"// <codegen:{entity.Name}>";
        if (current.Contains(marker, StringComparison.Ordinal)) return new PlannedFile(path, PlannedFileAction.Skip, current, current, null);
        if (current.Contains($"DbSet<{entity.Name}>", StringComparison.Ordinal))
            return new PlannedFile(path, PlannedFileAction.Skip, current, current, null);
        const string dbSetAnchor = "    /* Add DbSet properties for your Aggregate Roots / Entities here. */";
        const string configurationAnchor = "        /* Configure your own tables/entities inside here */";
        if (!current.Contains(dbSetAnchor, StringComparison.Ordinal) || !current.Contains(configurationAnchor, StringComparison.Ordinal))
            return new PlannedFile(path, PlannedFileAction.Conflict, current, current, "DbContext anchors are missing; no source was modified.");
        var generated = current
            .Replace("using Microsoft.EntityFrameworkCore;", $"using Microsoft.EntityFrameworkCore;{Environment.NewLine}using {entity.Namespace};", StringComparison.Ordinal)
            .Replace(dbSetAnchor, $"{dbSetAnchor}{Environment.NewLine}{Environment.NewLine}    {marker}{Environment.NewLine}    public DbSet<{entity.Name}> {entity.Name}s {{ get; set; }}{Environment.NewLine}    // </codegen:{entity.Name}>", StringComparison.Ordinal)
            .Replace(configurationAnchor, $"{configurationAnchor}{Environment.NewLine}{Environment.NewLine}        {marker}{Environment.NewLine}        builder.ApplyConfiguration(new {entity.Name}EntityTypeConfiguration());{Environment.NewLine}        // </codegen:{entity.Name}>", StringComparison.Ordinal);
        return new PlannedFile(path, PlannedFileAction.Update, generated, current, SimpleDiff(current, generated));
    }

    private static string RenderRepositoryInterface(EntityModel entity)
        => Header(entity.Namespace).AppendLine("using Volo.Abp.Domain.Repositories;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public interface I{entity.Name}Repository : IRepository<{entity.Name}, {entity.KeyType}>")
            .AppendLine("{").AppendLine("}").ToString();

    private static string RenderAppServiceInterface(EntityModel entity, EntityDescriptor? descriptor)
    {
        var crud = descriptor?.Crud ?? new CrudDescriptor();
        var sb = Header(entity.Namespace).AppendLine("using System.Threading.Tasks;").AppendLine("using Volo.Abp.Application.Dtos;")
            .AppendLine("using Volo.Abp.Application.Services;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public interface I{entity.Name}AppService : IApplicationService").AppendLine("{");
        if (crud.Get) sb.AppendLine(CultureInfo.InvariantCulture, $"    Task<{entity.Name}Dto> GetAsync({entity.KeyType} id);");
        if (crud.GetList) sb.AppendLine(CultureInfo.InvariantCulture, $"    Task<ListResultDto<{entity.Name}Dto>> GetListAsync({entity.Name}GetListInput input);");
        if (crud.Create) sb.AppendLine(CultureInfo.InvariantCulture, $"    Task<{entity.Name}Dto> CreateAsync({entity.Name}CreateInput input);");
        if (crud.Update) sb.AppendLine(CultureInfo.InvariantCulture, $"    Task<{entity.Name}Dto> UpdateAsync({entity.KeyType} id, {entity.Name}UpdateInput input);");
        if (crud.Delete) sb.AppendLine(CultureInfo.InvariantCulture, $"    Task DeleteAsync({entity.KeyType} id);");
        return sb.AppendLine("}").ToString();
    }

    private static string RenderAppServiceBase(EntityModel entity, EntityDescriptor? descriptor)
    {
        var crud = descriptor?.Crud ?? new CrudDescriptor();
        var permissions = descriptor?.Permissions.Enabled ?? true;
        var construction = descriptor?.Construction?.Parameters;
        var update = descriptor?.Update;
        if (crud.Create && (construction is null || construction.Count == 0))
            throw new InvalidOperationException($"{entity.Name} requires construction.parameters for Create.");
        if ((crud.Create || crud.Update) && (update is null || string.IsNullOrWhiteSpace(update.Method)))
            throw new InvalidOperationException($"{entity.Name} requires update.method for Create/Update.");
        var sb = new StringBuilder("// <auto-generated />\n#nullable enable\n\nusing System;\nusing System.Linq;\nusing System.Threading.Tasks;\nusing Microsoft.AspNetCore.Authorization;\nusing Volo.Abp.Application.Dtos;\nusing Volo.Abp.Application.Services;\n");
        if (permissions) sb.AppendLine(CultureInfo.InvariantCulture, $"using {RootNamespace(entity)}.Permissions;");
        sb.AppendLine().AppendLine(CultureInfo.InvariantCulture, $"namespace {entity.Namespace};").AppendLine();
        if (permissions) sb.AppendLine(CultureInfo.InvariantCulture, $"[Authorize({entity.Name}Permissions.Default)]");
        sb.AppendLine(CultureInfo.InvariantCulture, $"public abstract class {entity.Name}AppServiceBase : ApplicationService, I{entity.Name}AppService")
            .AppendLine("{").AppendLine(CultureInfo.InvariantCulture, $"    protected I{entity.Name}Repository Repository {{ get; }}").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"    protected {entity.Name}AppServiceBase(I{entity.Name}Repository repository) => Repository = repository;").AppendLine();
        if (crud.Get)
        {
            AppendAuthorization(sb, entity, "Default", permissions);
            sb.AppendLine(CultureInfo.InvariantCulture, $"    public virtual async Task<{entity.Name}Dto> GetAsync({entity.KeyType} id) => {entity.Name}Mapper.ToDto(await Repository.GetAsync(x => x.Id == id));").AppendLine();
        }
        if (crud.GetList)
        {
            AppendAuthorization(sb, entity, "Default", permissions);
            sb.AppendLine(CultureInfo.InvariantCulture, $"    public virtual async Task<ListResultDto<{entity.Name}Dto>> GetListAsync({entity.Name}GetListInput input)")
                .AppendLine("    {").AppendLine("        var query = await Repository.GetQueryableAsync();")
                .AppendLine(RenderFilters(entity, descriptor)).AppendLine(RenderSorting(entity, descriptor))
                .AppendLine("        var items = await AsyncExecuter.ToListAsync(sorted.Skip(input.SkipCount).Take(input.MaxResultCount));")
                .AppendLine(CultureInfo.InvariantCulture, $"        return new ListResultDto<{entity.Name}Dto>(items.Select({entity.Name}Mapper.ToDto).ToList());")
                .AppendLine("    }").AppendLine();
        }
        if (crud.Create)
        {
            var arguments = string.Join(", ", construction!.Select(name => $"input.{name}"));
            var prefix = entity.KeyType == "Guid" ? "GuidGenerator.Create(), " : string.Empty;
            var updateArguments = string.Join(", ", update!.Parameters.Select(name => $"input.{name}"));
            AppendAuthorization(sb, entity, "Create", permissions);
            sb.AppendLine(CultureInfo.InvariantCulture, $"    public virtual async Task<{entity.Name}Dto> CreateAsync({entity.Name}CreateInput input)")
                .AppendLine("    {").AppendLine(CultureInfo.InvariantCulture, $"        var entity = new {entity.Name}({prefix}{arguments});")
                .AppendLine(CultureInfo.InvariantCulture, $"        entity.{update.Method}({updateArguments});")
                .AppendLine(CultureInfo.InvariantCulture, $"        return {entity.Name}Mapper.ToDto(await Repository.InsertAsync(entity, autoSave: true));")
                .AppendLine("    }").AppendLine();
        }
        if (crud.Update)
        {
            var updateArguments = string.Join(", ", update!.Parameters.Select(name => $"input.{name}"));
            AppendAuthorization(sb, entity, "Update", permissions);
            sb.AppendLine(CultureInfo.InvariantCulture, $"    public virtual async Task<{entity.Name}Dto> UpdateAsync({entity.KeyType} id, {entity.Name}UpdateInput input)")
                .AppendLine("    {").AppendLine("        var entity = await Repository.GetAsync(x => x.Id == id);")
                .AppendLine(CultureInfo.InvariantCulture, $"        entity.{update.Method}({updateArguments});")
                .AppendLine(CultureInfo.InvariantCulture, $"        return {entity.Name}Mapper.ToDto(await Repository.UpdateAsync(entity, autoSave: true));")
                .AppendLine("    }").AppendLine();
        }
        if (crud.Delete)
        {
            AppendAuthorization(sb, entity, "Delete", permissions);
            sb.AppendLine(CultureInfo.InvariantCulture, $"    public virtual Task DeleteAsync({entity.KeyType} id) => Repository.DeleteAsync(x => x.Id == id, autoSave: true);");
        }
        return sb.AppendLine("}").ToString();
    }

    private static void AppendAuthorization(StringBuilder builder, EntityModel entity, string permission, bool enabled)
    {
        if (enabled) builder.AppendLine(CultureInfo.InvariantCulture, $"    [Authorize({entity.Name}Permissions.{permission})]");
    }

    private static string RenderAppService(EntityModel entity)
        => new StringBuilder($"namespace {entity.Namespace};\n\npublic class {entity.Name}AppService : {entity.Name}AppServiceBase\n{{\n    public {entity.Name}AppService(I{entity.Name}Repository repository) : base(repository) {{ }}\n}}\n").ToString();

    private static string RenderRepositoryBase(EntityModel entity)
        => Header(entity.Namespace)
            .AppendLine(string.Format(CultureInfo.InvariantCulture, "using {0}.EntityFrameworkCore;", RootNamespace(entity))).AppendLine("using Volo.Abp.Domain.Repositories.EntityFrameworkCore;").AppendLine("using Volo.Abp.EntityFrameworkCore;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public abstract class {entity.Name}RepositoryBase : EfCoreRepository<{ProjectName(entity)}DbContext, {entity.Name}, {entity.KeyType}>, I{entity.Name}Repository")
            .AppendLine("{")
            .AppendLine(CultureInfo.InvariantCulture, $"    protected {entity.Name}RepositoryBase(IDbContextProvider<{ProjectName(entity)}DbContext> dbContextProvider) : base(dbContextProvider) {{ }}")
            .AppendLine("}").ToString();

    private static string RenderRepository(EntityModel entity)
        => new StringBuilder($"using {RootNamespace(entity)}.EntityFrameworkCore;\nusing Volo.Abp.EntityFrameworkCore;\n\nnamespace {entity.Namespace};\n\npublic sealed class {entity.Name}Repository : {entity.Name}RepositoryBase\n{{\n    public {entity.Name}Repository(IDbContextProvider<{ProjectName(entity)}DbContext> dbContextProvider) : base(dbContextProvider) {{ }}\n}}\n").ToString();

    private static string RenderEfConfigurationBase(EntityModel entity, EntityDescriptor? descriptor)
    {
        var sb = Header(entity.Namespace)
            .AppendLine("using Microsoft.EntityFrameworkCore;").AppendLine("using Microsoft.EntityFrameworkCore.Metadata.Builders;").AppendLine("using Volo.Abp.EntityFrameworkCore.Modeling;").AppendLine()
            .AppendLine(string.Format(CultureInfo.InvariantCulture, "public abstract class {0}EntityTypeConfigurationBase : IEntityTypeConfiguration<{0}>", entity.Name))
            .AppendLine("{")
            .AppendLine(string.Format(CultureInfo.InvariantCulture, "    public virtual void Configure(EntityTypeBuilder<{0}> builder)", entity.Name))
            .AppendLine("    {").AppendLine("        builder.ConfigureByConvention();");
        foreach (var property in entity.Properties.Where(x => !x.IsSystemManaged))
        {
            PropertyDescriptor? setting = null;
            descriptor?.Properties.TryGetValue(property.Name, out setting);
            var required = setting?.Required ?? property.Constraints?.IsRequired ?? false;
            var maxLength = setting?.MaxLength ?? property.Constraints?.MaxLength ?? property.Constraints?.StringLength;
            var defaultValue = setting?.DefaultValue ?? property.Constraints?.DefaultValue;
            if (!required && maxLength is not > 0 && string.IsNullOrWhiteSpace(defaultValue)) continue;
            sb.Append(CultureInfo.InvariantCulture, $"        builder.Property(x => x.{property.Name})");
            if (required) sb.Append(".IsRequired()");
            if (maxLength is > 0) sb.Append(CultureInfo.InvariantCulture, $".HasMaxLength({maxLength.Value})");
            if (!string.IsNullOrWhiteSpace(defaultValue)) sb.Append(CultureInfo.InvariantCulture, $".HasDefaultValue({EfDefaultLiteral(property, defaultValue)})");
            sb.AppendLine(";");
        }
        return sb.AppendLine("    }").AppendLine("}").ToString();
    }

    private static string EfDefaultLiteral(EntityPropertyModel property, string value)
    {
        var type = property.TypeName.TrimEnd('?');
        if (type == "string") return StringLiteral(value);
        if (type == "bool" && bool.TryParse(value, out var boolean)) return boolean.ToString().ToLowerInvariant();
        if (type is "byte" or "short" or "int" or "long" or "float" or "double" or "decimal" && decimal.TryParse(value, CultureInfo.InvariantCulture, out _)) return value;
        return StringLiteral(value);
    }

    private static string RenderEfConfiguration(EntityModel entity)
        => new StringBuilder($"using Microsoft.EntityFrameworkCore.Metadata.Builders;\n\nnamespace {entity.Namespace};\n\npublic sealed class {entity.Name}EntityTypeConfiguration : {entity.Name}EntityTypeConfigurationBase\n{{\n    public override void Configure(EntityTypeBuilder<{entity.Name}> builder)\n    {{\n        base.Configure(builder);\n    }}\n}}\n").ToString();

    private static string RenderPermissions(EntityModel entity, EntityDescriptor? descriptor)
    {
        var crud = descriptor?.Crud ?? new CrudDescriptor();
        var sb = new StringBuilder("// <auto-generated />\n\n")
            .AppendLine(CultureInfo.InvariantCulture, $"namespace {RootNamespace(entity)}.Permissions;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public static class {entity.Name}Permissions").AppendLine("{")
            .AppendLine(CultureInfo.InvariantCulture, $"    public const string Default = \"{RootNamespace(entity)}.{entity.Name}\";");
        if (crud.Create) sb.AppendLine("    public const string Create = Default + \".Create\";");
        if (crud.Update) sb.AppendLine("    public const string Update = Default + \".Update\";");
        if (crud.Delete) sb.AppendLine("    public const string Delete = Default + \".Delete\";");
        return sb.AppendLine("}").ToString();
    }

    private static string RenderPermissionProvider(EntityModel entity, EntityDescriptor? descriptor)
    {
        var crud = descriptor?.Crud ?? new CrudDescriptor();
        var sb = new StringBuilder("// <auto-generated />\n\n")
            .AppendLine(CultureInfo.InvariantCulture, $"using {RootNamespace(entity)}.Localization;")
            .AppendLine("using Volo.Abp.Authorization.Permissions;").AppendLine("using Volo.Abp.Localization;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"namespace {RootNamespace(entity)}.Permissions;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public sealed class {entity.Name}PermissionDefinitionProvider : PermissionDefinitionProvider")
            .AppendLine("{").AppendLine("    public override void Define(IPermissionDefinitionContext context)").AppendLine("    {");
        if (descriptor?.Permissions.Enabled ?? true)
        {
            sb.AppendLine(CultureInfo.InvariantCulture, $"        var permission = (context.GetGroupOrNull({ProjectName(entity)}Permissions.GroupName) ?? context.AddGroup({ProjectName(entity)}Permissions.GroupName)).AddPermission({entity.Name}Permissions.Default, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}\"));");
            if (crud.Create) sb.AppendLine(CultureInfo.InvariantCulture, $"        permission.AddChild({entity.Name}Permissions.Create, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}.Create\"));");
            if (crud.Update) sb.AppendLine(CultureInfo.InvariantCulture, $"        permission.AddChild({entity.Name}Permissions.Update, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}.Update\"));");
            if (crud.Delete) sb.AppendLine(CultureInfo.InvariantCulture, $"        permission.AddChild({entity.Name}Permissions.Delete, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}.Delete\"));");
        }
        return sb.AppendLine("    }").AppendLine("}").ToString();
    }

    private static string RenderMapper(EntityModel entity, EntityDescriptor? descriptor)
        => $"// <auto-generated />\n\nnamespace {entity.Namespace};\n\npublic static class {entity.Name}Mapper\n{{\n    public static {entity.Name}Dto ToDto({entity.Name} source) => new()\n    {{\n{string.Join(Environment.NewLine, entity.Properties.Where(x => !x.IsSystemManaged && IsEnabled(descriptor, x.Name, setting => setting.Dto, true)).Select(x => $"        {x.Name} = source.{x.Name},"))}\n    }};\n}}\n";

    private static string SimpleDiff(string current, string generated)
        => $"--- current{Environment.NewLine}+++ generated{Environment.NewLine}-{current.Length} chars{Environment.NewLine}+{generated.Length} chars";

    private static string RootNamespace(EntityModel entity) => string.Join('.', entity.Namespace.Split('.').Take(2));
    private static string ProjectName(EntityModel entity) => RootNamespace(entity).Split('.').Last();
}



