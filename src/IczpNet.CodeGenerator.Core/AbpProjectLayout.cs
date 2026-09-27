namespace IczpNet.CodeGenerator.Core;

public sealed record AbpProjectLayout(
    string SolutionRoot,
    string DomainProject,
    string ContractsProject,
    string ApplicationProject,
    string EntityFrameworkCoreProject,
    string FeatureFolder,
    AbpVersionProfile? AbpProfile = null);

public static class AbpProjectLayoutResolver
{
    public static AbpProjectLayout Resolve(string entityProjectRoot, EntityModel entity)
    {
        var solutionRoot = FindSolutionRoot(entityProjectRoot);
        var src = Path.Combine(solutionRoot, "src");
        var projectPrefix = string.Join('.', entity.Namespace.Split('.').Take(2));
        var domain = Path.Combine(src, $"{projectPrefix}.Domain");
        var contracts = Path.Combine(src, $"{projectPrefix}.Application.Contracts");
        var application = Path.Combine(src, $"{projectPrefix}.Application");
        var efCore = Path.Combine(src, $"{projectPrefix}.EntityFrameworkCore");
        foreach (var required in new[] { domain, contracts, application, efCore })
        {
            if (!Directory.Exists(required)) throw new InvalidOperationException($"Required ABP project was not found: {required}");
        }
        var feature = string.Join(Path.DirectorySeparatorChar, entity.Namespace.Split('.').Skip(2));
        return new AbpProjectLayout(solutionRoot, domain, contracts, application, efCore, feature, AbpVersionProfileResolver.Resolve(domain));
    }

    private static string FindSolutionRoot(string startingDirectory)
    {
        for (var current = new DirectoryInfo(Path.GetFullPath(startingDirectory)); current is not null; current = current.Parent)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "src"))) return current.FullName;
        }
        throw new InvalidOperationException($"Could not find an ABP solution root containing 'src' above {startingDirectory}.");
    }
}
