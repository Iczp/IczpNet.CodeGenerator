using IczpNet.CodeGenerator.Core;
using Xunit;

namespace IczpNet.CodeGenerator.Core.Tests;

public sealed class GenerationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"abpgen-tests-{Guid.NewGuid():N}");

    [Theory]
    [InlineData("yaml")]
    [InlineData("json")]
    public void DescriptorStoreRoundTripsBothFormats(string format)
    {
        var descriptor = Descriptor();
        DescriptorStore.Save(_root, descriptor, format);

        var loaded = DescriptorStore.Load(_root, "Article");

        Assert.NotNull(loaded);
        Assert.Equal(descriptor.Entity, loaded.Entity);
        Assert.Equal("标题", loaded.Properties["Title"].DisplayName);
        Assert.Equal(256, loaded.Properties["Title"].MaxLength);
    }

    [Fact]
    public void PlanEmitsValidationMetadataAndEfConfiguration()
    {
        var layout = Layout();
        var plan = GenerationService.CreateDtoPlan(Entity(), layout, Descriptor());
        var dto = plan.Files.Single(x => string.Equals(Path.GetFileName(x.Path), "ArticleDto.g.cs", StringComparison.Ordinal)).Content;
        var ef = plan.Files.Single(x => x.Path.EndsWith("ArticleEntityTypeConfigurationBase.g.cs", StringComparison.Ordinal)).Content;

        Assert.Contains("[Required]", dto, StringComparison.Ordinal);
        Assert.Contains("[StringLength(256)]", dto, StringComparison.Ordinal);
        Assert.Contains("[Display(Name = \"标题\"", dto, StringComparison.Ordinal);
        Assert.Contains(".IsRequired().HasMaxLength(256).HasDefaultValue(\"Untitled\")", ef, StringComparison.Ordinal);
    }

    [Fact]
    public void PlanUsesEntityConstraintsWhenDescriptorDoesNotOverrideThem()
    {
        var entity = new EntityModel("Article", "Demo.Articles", "AggregateRoot<Guid>", "Guid",
            [new EntityPropertyModel("Title", "string", false, false, "Article title", new EntityPropertyConstraints(IsRequired: true, StringLength: 128, DefaultValue: "Draft"))], "test");
        var descriptor = new EntityDescriptor
        {
            Entity = entity.FullName,
            DefaultSorting = "Title asc",
            Construction = new EntityConstructionDescriptor { Parameters = ["Title"] },
            Update = new EntityUpdateDescriptor { Method = "Update", Parameters = ["Title"] },
            Properties = new Dictionary<string, PropertyDescriptor> { ["Title"] = new() { Sortable = true } }
        };
        var plan = GenerationService.CreateDtoPlan(entity, Layout(), descriptor);
        var dto = plan.Files.Single(file => Path.GetFileName(file.Path) == "ArticleDto.g.cs").Content;
        var ef = plan.Files.Single(file => Path.GetFileName(file.Path) == "ArticleEntityTypeConfigurationBase.g.cs").Content;

        Assert.Contains("/// Article title", dto, StringComparison.Ordinal);
        Assert.Contains("[Required]", dto, StringComparison.Ordinal);
        Assert.Contains("[StringLength(128)]", dto, StringComparison.Ordinal);
        Assert.Contains("= \"Draft\";", dto, StringComparison.Ordinal);
        Assert.Contains(".IsRequired().HasMaxLength(128).HasDefaultValue(\"Draft\")", ef, StringComparison.Ordinal);
    }

    [Fact]
    public void PlanMarksManuallyOwnedTargetAsConflict()
    {
        var layout = Layout();
        var target = Path.Combine(layout.ContractsProject, layout.FeatureFolder, "ArticleDto.g.cs");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.WriteAllText(target, "// manual source");

        var plan = GenerationService.CreateDtoPlan(Entity(), layout, Descriptor());

        Assert.True(plan.HasConflicts);
        Assert.Equal(PlannedFileAction.Conflict, plan.Files.Single(x => x.Path == target).Action);
    }

    [Fact]
    public void CrudPermissionsAndSortingControlGeneratedCode()
    {
        var descriptor = new EntityDescriptor
        {
            Entity = "Demo.Articles.Article",
            Crud = new CrudDescriptor { Get = true, GetList = true, Create = false, Update = false, Delete = false },
            Permissions = new PermissionDescriptor { Enabled = false },
            DefaultSorting = "Title asc",
            Properties = new Dictionary<string, PropertyDescriptor> { ["Title"] = new() { Sortable = true } }
        };
        var plan = GenerationService.CreateDtoPlan(Entity(), Layout(), descriptor);
        string Content(string name) => plan.Files.Single(file => Path.GetFileName(file.Path) == name).Content;

        Assert.Contains("GetAsync(Guid id)", Content("IArticleAppService.g.cs"));
        Assert.Contains("GetListAsync", Content("IArticleAppService.g.cs"));
        Assert.DoesNotContain("CreateAsync", Content("IArticleAppService.g.cs"));
        Assert.DoesNotContain("UpdateAsync", Content("IArticleAppService.g.cs"));
        Assert.DoesNotContain("DeleteAsync", Content("IArticleAppService.g.cs"));
        Assert.DoesNotContain("[Authorize", Content("ArticleAppServiceBase.g.cs"));
        Assert.Contains("\"Title asc\" => query.OrderBy(x => x.Title)", Content("ArticleAppServiceBase.g.cs"));
        Assert.Contains("_ => query.OrderBy(x => x.Title)", Content("ArticleAppServiceBase.g.cs"));
        Assert.Contains("= \"Title asc\"", Content("ArticleGetListInput.g.cs"));
        Assert.DoesNotContain("AddPermission(", Content("ArticlePermissionDefinitionProvider.g.cs"));
        Assert.DoesNotContain("public const string Create", Content("ArticlePermissions.g.cs"));
    }

    [Fact]
    public void IntKeyEnumAndNullableFieldsShapeGeneratedCode()
    {
        var entity = new EntityModel("CatalogEntry", "Demo.Catalog", "FullAuditedAggregateRoot<int>", "int",
            [new("Name", "string", false, false), new("Status", "CatalogStatus", false, false), new("ReleaseAt", "DateTime?", true, false)], "test");
        var descriptor = new EntityDescriptor
        {
            Entity = entity.FullName,
            DefaultSorting = "Name asc",
            Construction = new EntityConstructionDescriptor { Parameters = ["Name"] },
            Update = new EntityUpdateDescriptor { Method = "Update", Parameters = ["Name", "Status", "ReleaseAt"] },
            Properties = new Dictionary<string, PropertyDescriptor>
            {
                ["Name"] = new() { Sortable = true },
                ["Status"] = new() { Filter = "equals" },
                ["ReleaseAt"] = new() { Filter = "range" }
            }
        };
        var plan = GenerationService.CreateDtoPlan(entity, Layout(), descriptor);
        string Content(string name) => plan.Files.Single(file => Path.GetFileName(file.Path) == name).Content;

        Assert.Contains("IRepository<CatalogEntry, int>", Content("ICatalogEntryRepository.g.cs"));
        Assert.Contains("EfCoreRepository<CatalogDbContext, CatalogEntry, int>", Content("CatalogEntryRepositoryBase.g.cs"));
        Assert.Contains("GetAsync(int id)", Content("ICatalogEntryAppService.g.cs"));
        Assert.Contains("new CatalogEntry(input.Name)", Content("CatalogEntryAppServiceBase.g.cs"));
        Assert.Contains("CatalogStatus? Status", Content("CatalogEntryGetListInput.g.cs"));
        Assert.Contains("DateTime? ReleaseAtMin", Content("CatalogEntryGetListInput.g.cs"));
    }

    [Fact]
    public async Task FailedGeneratedBuildLeavesTargetUnchanged()
    {
        var layout = BuildableLayout();
        var path = Path.Combine(layout.ContractsProject, "Generated.cs");
        var plan = new GenerationPlan([new PlannedFile(path, PlannedFileAction.Create, "not valid c#", null, null)]);

        var result = await GenerationWorkflow.ValidateAsync(plan, layout);

        Assert.False(result.Succeeded);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void BatchPreflightRejectsChangedFileBeforeWritingOtherFiles()
    {
        var layout = BuildableLayout();
        var changed = Path.Combine(layout.ContractsProject, "Changed.g.cs");
        var created = Path.Combine(layout.ContractsProject, "New.g.cs");
        File.WriteAllText(changed, "user edit");
        var plan = new GenerationPlan([
            new PlannedFile(created, PlannedFileAction.Create, "// <auto-generated />", null, null),
            new PlannedFile(changed, PlannedFileAction.Update, "// <auto-generated />", "old content", null)
        ]);

        Assert.Throws<IOException>(() => GenerationWorkflow.Apply(plan, layout.SolutionRoot));
        Assert.False(File.Exists(created));
        Assert.Equal("user edit", File.ReadAllText(changed));
    }

    [Fact]
    public void UnresolvedConflictStopsEntireBatch()
    {
        var layout = BuildableLayout();
        var created = Path.Combine(layout.ContractsProject, "New.g.cs");
        var conflict = Path.Combine(layout.ContractsProject, "Manual.g.cs");
        File.WriteAllText(conflict, "manual");
        var plan = new GenerationPlan([
            new PlannedFile(created, PlannedFileAction.Create, "// <auto-generated />", null, null),
            new PlannedFile(conflict, PlannedFileAction.Conflict, "// <auto-generated />", "manual", "manual file")
        ]);

        Assert.Throws<InvalidOperationException>(() => GenerationWorkflow.Apply(plan, layout.SolutionRoot));
        Assert.False(File.Exists(created));
        Assert.Equal("manual", File.ReadAllText(conflict));
    }

    [Fact]
    public void RecoverRestoresInterruptedTransaction()
    {
        var layout = BuildableLayout();
        var target = Path.Combine(layout.ContractsProject, "Generated.g.cs");
        File.WriteAllText(target, "partial new version");
        var transaction = Path.Combine(layout.SolutionRoot, ".abpgen-transactions", "test-transaction");
        Directory.CreateDirectory(transaction);
        File.WriteAllText(Path.Combine(transaction, "0000.bak"), "previous version");
        File.WriteAllText(Path.Combine(transaction, "journal.json"), "[{\"RelativePath\":\"src/Demo.Application.Contracts/Generated.g.cs\",\"Existed\":true,\"BackupName\":\"0000.bak\"}]");

        var recovered = GenerationWorkflow.Recover(layout.SolutionRoot);

        Assert.Single(recovered);
        Assert.Equal("previous version", File.ReadAllText(target));
        Assert.False(Directory.Exists(transaction));
    }

    [Fact]
    public void ApplyWritesWholeBatchAndCleansJournal()
    {
        var layout = BuildableLayout();
        var created = Path.Combine(layout.ContractsProject, "New.g.cs");
        var updated = Path.Combine(layout.ApplicationProject, "Existing.g.cs");
        File.WriteAllText(updated, "old generated");
        var plan = new GenerationPlan([
            new PlannedFile(created, PlannedFileAction.Create, "created", null, null),
            new PlannedFile(updated, PlannedFileAction.Update, "updated", "old generated", null)
        ]);

        var writes = GenerationWorkflow.Apply(plan, layout.SolutionRoot);

        Assert.Equal(2, writes.Count);
        Assert.Equal("created", File.ReadAllText(created));
        Assert.Equal("updated", File.ReadAllText(updated));
        var journalRoot = Path.Combine(layout.SolutionRoot, ".abpgen-transactions");
        Assert.Empty(Directory.EnumerateDirectories(journalRoot));
    }

    [Theory]
    [InlineData("yaml")]
    [InlineData("json")]
    public void StructuredSavePreservesUnknownAdvancedNodes(string format)
    {
        var directory = Path.Combine(_root, ".codegen", "entities");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"Article.codegen.{format}");
        var content = format == "json"
            ? "{\"entity\":\"Demo.Articles.Article\",\"profile\":\"iczp-ddd\",\"customAdvanced\":{\"index\":true},\"properties\":{\"Title\":{\"dto\":true,\"advancedHint\":\"keep\"}}}"
            : "entity: Demo.Articles.Article\nprofile: iczp-ddd\ncustomAdvanced:\n  index: true\nproperties:\n  Title:\n    dto: true\n    advancedHint: keep\n";
        File.WriteAllText(path, content);
        var document = DescriptorStore.LoadDocument(_root, "Article");
        var descriptor = new EntityDescriptor { Entity = "Demo.Articles.Article", Properties = new Dictionary<string, PropertyDescriptor> { ["Title"] = new() { DisplayName = "标题", Dto = true } } };

        DescriptorStore.SaveDocument(document, descriptor, format);

        var saved = File.ReadAllText(path);
        Assert.Contains("customAdvanced", saved, StringComparison.Ordinal);
        Assert.Contains("advancedHint", saved, StringComparison.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private static EntityModel Entity() => new("Article", "Demo.Articles", "FullAuditedAggregateRoot<Guid>", "Guid", [new EntityPropertyModel("Title", "string", false, false)], "test");
    private static EntityDescriptor Descriptor() => new()
    {
        Entity = "Demo.Articles.Article",
        Construction = new EntityConstructionDescriptor { Parameters = ["Title"] },
        Update = new EntityUpdateDescriptor { Method = "Update", Parameters = ["Title"] },
        Properties = new Dictionary<string, PropertyDescriptor> { ["Title"] = new() { DisplayName = "标题", Description = "文章标题", Required = true, MaxLength = 256, DefaultValue = "Untitled" } }
    };
    private AbpProjectLayout Layout()
    {
        var ef = Path.Combine(_root, "Ef");
        Directory.CreateDirectory(ef);
        File.WriteAllText(Path.Combine(ef, "CmsDbContext.cs"), "using Microsoft.EntityFrameworkCore;\npublic sealed class CmsDbContext {\n    /* Add DbSet properties for your Aggregate Roots / Entities here. */\n    void Configure(ModelBuilder builder) {\n        /* Configure your own tables/entities inside here */\n    }\n}");
        return new AbpProjectLayout(_root, Path.Combine(_root, "Domain"), Path.Combine(_root, "Contracts"), Path.Combine(_root, "Application"), ef, "Articles");
    }

    private AbpProjectLayout BuildableLayout()
    {
        var contracts = Path.Combine(_root, "src", "Demo.Application.Contracts");
        var application = Path.Combine(_root, "src", "Demo.Application");
        var ef = Path.Combine(_root, "src", "Demo.EntityFrameworkCore");
        foreach (var project in new[] { contracts, application, ef })
        {
            Directory.CreateDirectory(project);
            var name = Path.GetFileName(project);
            File.WriteAllText(Path.Combine(project, $"{name}.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>");
        }
        return new AbpProjectLayout(_root, Path.Combine(_root, "src", "Demo.Domain"), contracts, application, ef, "Articles");
    }
}
