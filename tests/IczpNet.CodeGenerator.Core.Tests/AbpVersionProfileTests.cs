using IczpNet.CodeGenerator.Core;
using Xunit;

namespace IczpNet.CodeGenerator.Core.Tests;

public sealed class AbpVersionProfileTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"abpgen-profile-tests-{Guid.NewGuid():N}");

    [Fact]
    public void ResolvesAbp106FromProjectPackageReferences()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "Demo.Domain.csproj"), """
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <PackageReference Include="Volo.Abp.Ddd.Domain" Version="10.6.1" />
                <PackageReference Include="Volo.Abp.Authorization" Version="10.6.1" />
              </ItemGroup>
            </Project>
            """);

        var profile = AbpVersionProfileResolver.Resolve(_root);

        Assert.Equal("abp-10.6", profile.Name);
    }

    [Fact]
    public void RejectsUnsupportedAbpMinorVersion()
    {
        var exception = Assert.Throws<NotSupportedException>(() => AbpVersionProfileResolver.Resolve(new Version(10, 7, 0)));

        Assert.Contains("10.7", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void NormalizesTheLegacyProfileName()
    {
        Assert.Equal("abp-10.6", AbpVersionProfileResolver.NormalizeProfileName("iczp-ddd"));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
