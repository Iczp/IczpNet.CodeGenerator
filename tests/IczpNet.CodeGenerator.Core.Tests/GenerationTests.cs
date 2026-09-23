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

    private static EntityModel Entity() => new("Article", "Demo.Articles", "AggregateRoot<Guid>", "Guid", [new EntityPropertyModel("Title", "string", false, false)], "test");
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
}
