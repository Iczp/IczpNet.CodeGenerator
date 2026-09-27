using System.Xml.Linq;

namespace IczpNet.CodeGenerator.Core;

public sealed record AbpVersionProfile(string Name, Version MinimumVersion, Version MaximumExclusiveVersion)
{
    public bool Supports(Version version) => version >= MinimumVersion && version < MaximumExclusiveVersion;
}

public static class AbpVersionProfileResolver
{
    public static readonly AbpVersionProfile Abp106 = new("abp-10.6", new Version(10, 6, 0), new Version(10, 7, 0));

    public static string NormalizeProfileName(string? profileName)
        => string.Equals(profileName, "iczp-ddd", StringComparison.OrdinalIgnoreCase) ? Abp106.Name : profileName ?? Abp106.Name;

    public static AbpVersionProfile Resolve(string projectDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(projectDirectory);
        var projectFiles = Directory.EnumerateFiles(projectDirectory, "*.csproj", SearchOption.TopDirectoryOnly).ToArray();
        if (projectFiles.Length != 1)
        {
            throw new InvalidOperationException($"Expected exactly one project file under '{projectDirectory}'.");
        }

        var versions = XDocument.Load(projectFiles[0])
            .Descendants("PackageReference")
            .Where(element => (string?)element.Attribute("Include") is { } include && include.StartsWith("Volo.Abp.", StringComparison.Ordinal))
            .Select(element => (string?)element.Attribute("Version") ?? element.Element("Version")?.Value)
            .Where(version => !string.IsNullOrWhiteSpace(version))
            .Select(version => ParseVersion(version!))
            .Distinct()
            .ToArray();

        if (versions.Length == 0)
        {
            throw new InvalidOperationException($"No explicit Volo.Abp.* PackageReference version was found in '{projectFiles[0]}'.");
        }
        if (versions.Length != 1)
        {
            throw new InvalidOperationException($"Multiple Volo.Abp.* versions were found in '{projectFiles[0]}': {string.Join(", ", versions)}.");
        }

        return Resolve(versions[0]);
    }

    public static AbpVersionProfile Resolve(Version version)
    {
        ArgumentNullException.ThrowIfNull(version);
        if (Abp106.Supports(version)) return Abp106;
        throw new NotSupportedException($"ABP version '{version}' is not supported. Supported versions: {Abp106.MinimumVersion.Major}.{Abp106.MinimumVersion.Minor}.x.");
    }

    private static Version ParseVersion(string value)
    {
        var normalized = value.Trim().Split('-', 2)[0];
        return Version.TryParse(normalized, out var version)
            ? version
            : throw new InvalidOperationException($"ABP package version '{value}' is not a supported literal version.");
    }
}
