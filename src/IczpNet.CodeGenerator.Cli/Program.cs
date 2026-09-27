using System.Text.Json;
using System.Diagnostics;
using IczpNet.CodeGenerator.Core;
using IczpNet.CodeGenerator.Roslyn;

return await App.RunAsync(args);

internal static class App
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static async Task<int> RunAsync(string[] args)
    {
        try
        {
            return args.FirstOrDefault() switch
            {
                "init" => await InitAsync(args.Skip(1).ToArray()),
                "inspect" => await InspectAsync(args.Skip(1).ToArray()),
                "entities" => await EntitiesAsync(args.Skip(1).ToArray()),
                "init-entity" => await InitEntityAsync(args.Skip(1).ToArray()),
                "generate" => await GenerateAsync(args.Skip(1).ToArray()),
                "validate" => await ValidateAsync(args.Skip(1).ToArray()),
                "recover" => Recover(args.Skip(1).ToArray()),
                "ui" => await UiAsync(args.Skip(1).ToArray()),
                _ => Help()
            };
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"error: {exception.Message}");
            return 2;
        }
    }

    private static Task<int> InitAsync(string[] args)
    {
        var root = ProjectPath(args);
        Directory.CreateDirectory(Path.Combine(root, ".codegen", "entities"));
        Directory.CreateDirectory(Path.Combine(root, ".codegen", "profiles"));
        var config = Path.Combine(root, ".codegen", "config.json");
        if (!File.Exists(config))
        {
            File.WriteAllText(config, JsonSerializer.Serialize(new { defaultProfile = "abp-10.6" }, JsonOptions));
        }

        Console.WriteLine($"Initialized .codegen in {root}");
        return Task.FromResult(0);
    }

    private static Task<int> InspectAsync(string[] args)
    {
        var entity = RequireEntity(args);
        var model = FindEntity(ProjectPath(args), entity);
        if (args.Contains("--json", StringComparer.Ordinal)) Console.WriteLine(JsonSerializer.Serialize(model, JsonOptions));
        else PrintEntity(model);
        return Task.FromResult(0);
    }

    private static Task<int> EntitiesAsync(string[] args)
    {
        var entities = EntityScanner.Scan(ProjectPath(args));
        if (args.Contains("--json", StringComparer.Ordinal)) Console.WriteLine(JsonSerializer.Serialize(entities, JsonOptions));
        else foreach (var entity in entities) Console.WriteLine(entity.FullName);
        return Task.FromResult(0);
    }

    private static Task<int> InitEntityAsync(string[] args)
    {
        var entity = RequireEntity(args);
        var root = ProjectPath(args);
        var model = FindEntity(root, entity);
        var format = OptionValue(args, "--format") ?? "json";
        if (format is not ("json" or "yaml")) throw new ArgumentException("--format must be json or yaml.");
        DescriptorStore.Save(root, new EntityDescriptor { Entity = model.FullName, Profile = "abp-10.6" }, format);
        Console.WriteLine(Path.Combine(root, ".codegen", "entities", $"{model.Name}.codegen.{(format == "yaml" ? "yaml" : "json")}"));
        return Task.FromResult(0);
    }

    private static async Task<int> GenerateAsync(string[] args)
    {
        var entityName = RequireEntity(args);
        var root = ProjectPath(args);
        var entity = FindEntity(root, entityName);
        var layout = AbpProjectLayoutResolver.Resolve(root, entity);
        var plan = GenerationService.CreateDtoPlan(entity, layout, DescriptorStore.Load(root, entity.Name));
        var dryRun = args.Contains("--dry-run", StringComparer.Ordinal);
        foreach (var file in plan.Files)
        {
            Console.WriteLine($"{file.Action.ToString().ToUpperInvariant(),-8} {file.Path}");
            if (!string.IsNullOrWhiteSpace(file.Diff)) Console.WriteLine(file.Diff);
        }
        if (plan.HasConflicts) return 3;
        if (dryRun) return 0;
        var validation = await GenerationWorkflow.ValidateAsync(plan, layout);
        foreach (var line in validation.Logs) Console.WriteLine(line);
        if (!validation.Succeeded) return 4;
        foreach (var line in GenerationWorkflow.Apply(plan, layout.SolutionRoot)) Console.WriteLine(line);
        return 0;
    }

    private static async Task<int> ValidateAsync(string[] args)
    {
        var entity = FindEntity(ProjectPath(args), RequireEntity(args));
        var layout = AbpProjectLayoutResolver.Resolve(ProjectPath(args), entity);
        var plan = GenerationService.CreateDtoPlan(entity, layout, DescriptorStore.Load(ProjectPath(args), entity.Name));
        if (plan.HasConflicts) return 3;
        var validation = await GenerationWorkflow.ValidateAsync(plan, layout);
        foreach (var line in validation.Logs) Console.WriteLine(line);
        return validation.Succeeded ? 0 : 4;
    }

    private static int Recover(string[] args)
    {
        var root = ProjectPath(args);
        for (var current = new DirectoryInfo(root); current is not null; current = current.Parent)
        {
            if (!Directory.Exists(Path.Combine(current.FullName, "src"))) continue;
            foreach (var log in GenerationWorkflow.Recover(current.FullName)) Console.WriteLine(log);
            return 0;
        }
        throw new InvalidOperationException($"Could not find a solution root containing 'src' above {root}.");
    }

    private static async Task<int> UiAsync(string[] args)
    {
        var root = ProjectPath(args);
        var port = OptionValue(args, "--port") ?? "5178";
        if (!int.TryParse(port, out var parsedPort) || parsedPort is < 1024 or > 65535) throw new ArgumentException("--port must be an integer between 1024 and 65535.");
        var generatorRoot = FindGeneratorRoot();
        var hostProject = Path.Combine(generatorRoot, "src", "IczpNet.CodeGenerator.Web", "IczpNet.CodeGenerator.Web.csproj");
        var process = Process.Start(new ProcessStartInfo("dotnet", $"run --project \"{hostProject}\" -- --project \"{root}\" --urls http://127.0.0.1:{parsedPort}") { UseShellExecute = false })
            ?? throw new InvalidOperationException("Could not start the local Web host.");
        Console.WriteLine($"ABP Generator Studio: http://127.0.0.1:{parsedPort}");
        Console.WriteLine("Press Ctrl+C to stop the local Web host.");
        ConsoleCancelEventHandler handler = (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        };
        Console.CancelKeyPress += handler;
        try { await process.WaitForExitAsync(); return process.ExitCode; }
        finally { Console.CancelKeyPress -= handler; if (!process.HasExited) process.Kill(entireProcessTree: true); }
    }

    private static EntityModel FindEntity(string root, string requested)
    {
        var matches = EntityScanner.Scan(root)
            .Where(x => string.Equals(x.Name, requested, StringComparison.Ordinal) || string.Equals(x.FullName, requested, StringComparison.Ordinal))
            .ToArray();
        return matches.Length switch
        {
            1 => matches[0],
            0 => throw new InvalidOperationException($"Entity '{requested}' was not found under {root}."),
            _ => throw new InvalidOperationException($"Entity '{requested}' is ambiguous. Use its full namespace-qualified name.")
        };
    }

    private static string RequireEntity(string[] args)
        => Positionals(args).FirstOrDefault()
           ?? throw new ArgumentException("An entity name is required.");

    private static string ProjectPath(string[] args)
    {
        var index = Array.IndexOf(args, "--project");
        var requested = index >= 0 && index + 1 < args.Length ? args[index + 1] : Directory.GetCurrentDirectory();
        return Path.GetFullPath(requested);
    }

    private static IEnumerable<string> Positionals(string[] args)
    {
        for (var index = 0; index < args.Length; index++)
        {
            if (string.Equals(args[index], "--project", StringComparison.Ordinal) || string.Equals(args[index], "--format", StringComparison.Ordinal) || string.Equals(args[index], "--port", StringComparison.Ordinal))
            {
                index++;
                continue;
            }

            if (!args[index].StartsWith('-')) yield return args[index];
        }
    }

    private static string? OptionValue(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private static string FindGeneratorRoot()
    {
        for (var current = new DirectoryInfo(Directory.GetCurrentDirectory()); current is not null; current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "IczpNet.CodeGenerator.sln"))) return current.FullName;
        }
        throw new InvalidOperationException("Could not locate the IczpNet.CodeGenerator source root.");
    }

    private static void PrintEntity(EntityModel entity)
    {
        Console.WriteLine($"Entity: {entity.FullName}");
        Console.WriteLine($"Base: {entity.BaseType ?? "(none)"}");
        Console.WriteLine($"Key: {entity.KeyType}");
        Console.WriteLine("Properties:");
        foreach (var property in entity.Properties) Console.WriteLine($"  {property.Name,-24} {property.TypeName}");
    }

    private static int Help()
    {
        Console.WriteLine("abpgen init [--project <path>]");
        Console.WriteLine("abpgen entities [--project <path>] [--json]");
        Console.WriteLine("abpgen inspect <entity> [--project <path>] [--json]");
        Console.WriteLine("abpgen init-entity <entity> [--project <path>] [--format json|yaml]");
        Console.WriteLine("abpgen generate <entity> [--project <path>] [--dry-run]");
        Console.WriteLine("abpgen validate <entity> [--project <path>]");
        Console.WriteLine("abpgen recover --project <solution-root>");
        Console.WriteLine("abpgen ui --project <path> [--port 5178]");
        return 1;
    }
}
