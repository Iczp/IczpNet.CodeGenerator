using System.Text;
using System.Globalization;

namespace IczpNet.CodeGenerator.Core;

public sealed class GenerationService
{
    public static GenerationPlan CreateDtoPlan(EntityModel entity, AbpProjectLayout layout, EntityDescriptor? descriptor = null)
    {
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
            Plan(layout.ContractsProject, layout.FeatureFolder, $"I{entity.Name}AppService.g.cs", RenderAppServiceInterface(entity)),
            Plan(layout.ApplicationProject, layout.FeatureFolder, $"{entity.Name}AppServiceBase.g.cs", RenderAppServiceBase(entity, descriptor)),
            PlanExtension(layout.ApplicationProject, layout.FeatureFolder, $"{entity.Name}AppService.cs", RenderAppService(entity)),
            Plan(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}RepositoryBase.g.cs", RenderRepositoryBase(entity)),
            PlanExtension(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}Repository.cs", RenderRepository(entity)),
            Plan(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}EntityTypeConfigurationBase.g.cs", RenderEfConfigurationBase(entity, descriptor)),
            PlanExtension(layout.EntityFrameworkCoreProject, layout.FeatureFolder, $"{entity.Name}EntityTypeConfiguration.cs", RenderEfConfiguration(entity)),
            PlanDbContext(layout, entity),
            Plan(layout.ContractsProject, "Permissions", $"{entity.Name}Permissions.g.cs", RenderPermissions(entity)),
            Plan(layout.ContractsProject, "Permissions", $"{entity.Name}PermissionDefinitionProvider.g.cs", RenderPermissionProvider(entity)),
            Plan(layout.ApplicationProject, layout.FeatureFolder, $"{entity.Name}Mapper.g.cs", RenderMapper(entity, descriptor))
        ]);
    }

    private static bool IsEnabled(EntityDescriptor? descriptor, string name, Func<PropertyDescriptor, bool?> getValue, bool defaultValue)
        => descriptor?.Properties.TryGetValue(name, out var setting) == true ? getValue(setting) ?? defaultValue : defaultValue;

    private static string RenderDto(EntityModel entity, string dtoName, IEnumerable<EntityPropertyModel> properties, EntityDescriptor? descriptor, Func<EntityPropertyModel, bool> include)
    {
        var sb = Header(entity.Namespace).AppendLine("using System.ComponentModel;").AppendLine("using System.ComponentModel.DataAnnotations;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public sealed class {dtoName}").AppendLine("{");
        foreach (var property in properties.Where(x => include(x) && IsEnabled(descriptor, x.Name, setting => setting.Dto, true)))
        {
            PropertyDescriptor? setting = null;
            descriptor?.Properties.TryGetValue(property.Name, out setting);
            AppendPropertyMetadata(sb, property, setting);
            sb.AppendLine(CultureInfo.InvariantCulture, $"    public {property.TypeName} {property.Name} {{ get; set; }}{PropertyInitializer(property, setting)}");
        }

        return sb.AppendLine("}").ToString();
    }

    private static void AppendPropertyMetadata(StringBuilder sb, EntityPropertyModel property, PropertyDescriptor? setting)
    {
        if (!string.IsNullOrWhiteSpace(setting?.Description))
        {
            sb.AppendLine("    /// <summary>").AppendLine(CultureInfo.InvariantCulture, $"    /// {XmlEscape(setting.Description)}")
                .AppendLine("    /// </summary>");
        }

        if (!string.IsNullOrWhiteSpace(setting?.DisplayName) || !string.IsNullOrWhiteSpace(setting?.Description))
        {
            var arguments = new List<string>();
            if (!string.IsNullOrWhiteSpace(setting?.DisplayName)) arguments.Add($"Name = {StringLiteral(setting.DisplayName)}");
            if (!string.IsNullOrWhiteSpace(setting?.Description)) arguments.Add($"Description = {StringLiteral(setting.Description)}");
            sb.AppendLine(CultureInfo.InvariantCulture, $"    [Display({string.Join(", ", arguments)})]");
        }

        if (setting?.Required == true) sb.AppendLine("    [Required]");
        if (setting?.MaxLength is > 0) sb.AppendLine(CultureInfo.InvariantCulture, $"    [StringLength({setting.MaxLength.Value})]");
        if (!string.IsNullOrWhiteSpace(setting?.DefaultValue)) sb.AppendLine(CultureInfo.InvariantCulture, $"    [DefaultValue({StringLiteral(setting.DefaultValue)})]");
    }

    private static string PropertyInitializer(EntityPropertyModel property, PropertyDescriptor? setting)
    {
        if (string.IsNullOrWhiteSpace(setting?.DefaultValue)) return " = default!;";
        var value = setting.DefaultValue.Trim();
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
        sb.AppendLine("    public string Sorting { get; set; } = \"CreationTime desc\";");

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
                lines.Add($"        if (!string.IsNullOrWhiteSpace(input.{property.Name})) query = query.Where(x => x.{property.Name}.Contains(input.{property.Name}!, StringComparison.OrdinalIgnoreCase));");
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

    private static string RenderSorting(string? sorting)
        => string.Equals(sorting, "CreationTime asc", StringComparison.OrdinalIgnoreCase)
            ? "query.OrderBy(x => x.CreationTime)"
            : "query.OrderByDescending(x => x.CreationTime)";

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
            .AppendLine(string.Format(CultureInfo.InvariantCulture, "public interface I{0}Repository : IRepository<{0}>", entity.Name))
            .AppendLine("{").AppendLine("}").ToString();

    private static string RenderAppServiceInterface(EntityModel entity)
        => Header(entity.Namespace).AppendLine("using System;").AppendLine("using System.Threading.Tasks;").AppendLine("using Volo.Abp.Application.Dtos;").AppendLine("using Volo.Abp.Application.Services;").AppendLine()
            .AppendLine(string.Format(CultureInfo.InvariantCulture, "public interface I{0}AppService : IApplicationService", entity.Name))
            .AppendLine("{")
            .AppendLine(CultureInfo.InvariantCulture, $"    Task<{entity.Name}Dto> GetAsync(Guid id);")
            .AppendLine(CultureInfo.InvariantCulture, $"    Task<ListResultDto<{entity.Name}Dto>> GetListAsync({entity.Name}GetListInput input);")
            .AppendLine(CultureInfo.InvariantCulture, $"    Task<{entity.Name}Dto> CreateAsync({entity.Name}CreateInput input);")
            .AppendLine(CultureInfo.InvariantCulture, $"    Task<{entity.Name}Dto> UpdateAsync(Guid id, {entity.Name}UpdateInput input);")
            .AppendLine("    Task DeleteAsync(Guid id);").AppendLine("}").ToString();

    private static string RenderAppServiceBase(EntityModel entity, EntityDescriptor? descriptor)
    {
        var construction = descriptor?.Construction?.Parameters ?? throw new InvalidOperationException($"{entity.Name} requires construction.parameters for CRUD generation.");
        var update = descriptor?.Update ?? throw new InvalidOperationException($"{entity.Name} requires update.method and update.parameters for CRUD generation.");
        if (construction.Count == 0 || string.IsNullOrWhiteSpace(update.Method)) throw new InvalidOperationException($"{entity.Name} has incomplete CRUD construction/update configuration.");
        var createArguments = string.Join(", ", construction.Select(x => $"input.{x}"));
        var updateArguments = string.Join(", ", update.Parameters.Select(x => $"input.{x}"));
        var filters = RenderFilters(entity, descriptor);
        var sorting = RenderSorting(descriptor?.DefaultSorting);
        return $"// <auto-generated />\n#nullable enable\n\nusing System;\nusing System.Linq;\nusing System.Threading.Tasks;\nusing Microsoft.AspNetCore.Authorization;\nusing Volo.Abp.Application.Dtos;\nusing Volo.Abp.Application.Services;\nusing {RootNamespace(entity)}.Permissions;\n\nnamespace {entity.Namespace};\n\n[Authorize({entity.Name}Permissions.Default)]\npublic abstract class {entity.Name}AppServiceBase : ApplicationService, I{entity.Name}AppService\n{{\n    protected I{entity.Name}Repository Repository {{ get; }}\n\n    protected {entity.Name}AppServiceBase(I{entity.Name}Repository repository) => Repository = repository;\n\n    [Authorize({entity.Name}Permissions.Default)]\n    public virtual async Task<{entity.Name}Dto> GetAsync(Guid id) => {entity.Name}Mapper.ToDto(await Repository.GetAsync(x => x.Id == id));\n\n    [Authorize({entity.Name}Permissions.Default)]\n    public virtual async Task<ListResultDto<{entity.Name}Dto>> GetListAsync({entity.Name}GetListInput input)\n    {{\n        var query = (await Repository.GetListAsync()).AsEnumerable();\n{filters}\n        var items = {sorting}.Skip(input.SkipCount).Take(input.MaxResultCount).ToList();\n        return new ListResultDto<{entity.Name}Dto>(items.Select({entity.Name}Mapper.ToDto).ToList());\n    }}\n\n    [Authorize({entity.Name}Permissions.Create)]\n    public virtual async Task<{entity.Name}Dto> CreateAsync({entity.Name}CreateInput input)\n    {{\n        var entity = new {entity.Name}(GuidGenerator.Create(), {createArguments});\n        entity.{update.Method}({updateArguments});\n        return {entity.Name}Mapper.ToDto(await Repository.InsertAsync(entity, autoSave: true));\n    }}\n\n    [Authorize({entity.Name}Permissions.Update)]\n    public virtual async Task<{entity.Name}Dto> UpdateAsync(Guid id, {entity.Name}UpdateInput input)\n    {{\n        var entity = await Repository.GetAsync(x => x.Id == id);\n        entity.{update.Method}({updateArguments});\n        return {entity.Name}Mapper.ToDto(await Repository.UpdateAsync(entity, autoSave: true));\n    }}\n\n    [Authorize({entity.Name}Permissions.Delete)]\n    public virtual Task DeleteAsync(Guid id) => Repository.DeleteAsync(x => x.Id == id, autoSave: true);\n}}\n";
    }

    private static string RenderAppService(EntityModel entity)
        => new StringBuilder($"namespace {entity.Namespace};\n\npublic sealed class {entity.Name}AppService : {entity.Name}AppServiceBase\n{{\n    public {entity.Name}AppService(I{entity.Name}Repository repository) : base(repository) {{ }}\n}}\n").ToString();

    private static string RenderRepositoryBase(EntityModel entity)
        => Header(entity.Namespace)
            .AppendLine(string.Format(CultureInfo.InvariantCulture, "using {0}.EntityFrameworkCore;", RootNamespace(entity))).AppendLine("using Volo.Abp.Domain.Repositories.EntityFrameworkCore;").AppendLine("using Volo.Abp.EntityFrameworkCore;").AppendLine()
            .AppendLine(CultureInfo.InvariantCulture, $"public abstract class {entity.Name}RepositoryBase : EfCoreRepository<{ProjectName(entity)}DbContext, {entity.Name}>, I{entity.Name}Repository")
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
            if (setting?.Required != true && setting?.MaxLength is not > 0 && string.IsNullOrWhiteSpace(setting?.DefaultValue)) continue;
            sb.Append(CultureInfo.InvariantCulture, $"        builder.Property(x => x.{property.Name})");
            if (setting.Required == true) sb.Append(".IsRequired()");
            if (setting.MaxLength is > 0) sb.Append(CultureInfo.InvariantCulture, $".HasMaxLength({setting.MaxLength.Value})");
            if (!string.IsNullOrWhiteSpace(setting.DefaultValue)) sb.Append(CultureInfo.InvariantCulture, $".HasDefaultValue({EfDefaultLiteral(property, setting.DefaultValue)})");
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

    private static string RenderPermissions(EntityModel entity)
        => new StringBuilder($"// <auto-generated />\n\nnamespace {RootNamespace(entity)}.Permissions;\n\npublic static class {entity.Name}Permissions\n{{\n    public const string Default = \"{RootNamespace(entity)}.{entity.Name}\";\n    public const string Create = Default + \".Create\";\n    public const string Update = Default + \".Update\";\n    public const string Delete = Default + \".Delete\";\n}}\n").ToString();

    private static string RenderPermissionProvider(EntityModel entity)
        => new StringBuilder($"// <auto-generated />\n\nusing {RootNamespace(entity)}.Localization;\nusing Volo.Abp.Authorization.Permissions;\nusing Volo.Abp.Localization;\n\nnamespace {RootNamespace(entity)}.Permissions;\n\npublic sealed class {entity.Name}PermissionDefinitionProvider : PermissionDefinitionProvider\n{{\n    public override void Define(IPermissionDefinitionContext context)\n    {{\n        var permission = context.AddGroup({ProjectName(entity)}Permissions.GroupName).AddPermission({entity.Name}Permissions.Default, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}\"));\n        permission.AddChild({entity.Name}Permissions.Create, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}.Create\"));\n        permission.AddChild({entity.Name}Permissions.Update, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}.Update\"));\n        permission.AddChild({entity.Name}Permissions.Delete, LocalizableString.Create<{ProjectName(entity)}Resource>(\"Permission:{entity.Name}.Delete\"));\n    }}\n}}\n").ToString();

    private static string RenderMapper(EntityModel entity, EntityDescriptor? descriptor)
        => $"// <auto-generated />\n\nnamespace {entity.Namespace};\n\npublic static class {entity.Name}Mapper\n{{\n    public static {entity.Name}Dto ToDto({entity.Name} source) => new()\n    {{\n{string.Join(Environment.NewLine, entity.Properties.Where(x => !x.IsSystemManaged && IsEnabled(descriptor, x.Name, setting => setting.Dto, true)).Select(x => $"        {x.Name} = source.{x.Name},"))}\n    }};\n}}\n";

    private static string SimpleDiff(string current, string generated)
        => $"--- current{Environment.NewLine}+++ generated{Environment.NewLine}-{current.Length} chars{Environment.NewLine}+{generated.Length} chars";

    private static string RootNamespace(EntityModel entity) => string.Join('.', entity.Namespace.Split('.').Take(2));
    private static string ProjectName(EntityModel entity) => RootNamespace(entity).Split('.').Last();
}



