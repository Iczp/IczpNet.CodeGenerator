using IczpNet.CodeGenerator.Roslyn;
using Xunit;

namespace IczpNet.CodeGenerator.Core.Tests;

public sealed class EntityScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"abpgen-scanner-tests-{Guid.NewGuid():N}");

    [Fact]
    public void ScansConstraintsDocumentationAndDomainOperations()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "Article.cs"), """
            using System;
            using System.ComponentModel.DataAnnotations;

            namespace Demo.Articles;

            public class Article : AggregateRoot<Guid>
            {
                /// <summary>Article title</summary>
                [Required]
                [StringLength(256)]
                public string Title { get; protected set; } = string.Empty;

                [MaxLength(2048)]
                public string? Content { get; set; }

                public Article(Guid id, string title) { }
                public void Update(string title, string? content) { }
            }
            """);

        var entity = Assert.Single(EntityScanner.Scan(_root));
        var title = entity.Properties.Single(property => property.Name == "Title");
        var content = entity.Properties.Single(property => property.Name == "Content");

        Assert.Equal("Guid", entity.KeyType);
        Assert.Equal("Article title", title.Documentation);
        Assert.True(title.Constraints!.IsRequired);
        Assert.Equal(256, title.Constraints.StringLength);
        Assert.False(title.HasPublicSetter);
        Assert.Equal(2048, content.Constraints!.MaxLength);
        Assert.True(content.HasPublicSetter);
        Assert.Collection(entity.Constructors!, constructor =>
        {
            Assert.True(constructor.IsPublic);
            Assert.Collection(constructor.Parameters,
                parameter => Assert.Equal("Guid", parameter.TypeName),
                parameter => Assert.Equal("string", parameter.TypeName));
        });
        var update = Assert.Single(entity.DomainMethods!);
        Assert.Equal("Update", update.Name);
        Assert.Equal(2, update.Parameters.Count);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
