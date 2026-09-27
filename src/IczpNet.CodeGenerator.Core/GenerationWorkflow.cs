using System.Diagnostics;
using System.Text.Json;

namespace IczpNet.CodeGenerator.Core;

public sealed record GenerationValidationResult(bool Succeeded, IReadOnlyList<string> Logs);

public static class GenerationWorkflow
{
    private static readonly StringComparer PathComparer = OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
    private sealed record JournalEntry(string RelativePath, bool Existed, string BackupName);

    public static async Task<GenerationValidationResult> ValidateAsync(
        GenerationPlan plan,
        AbpProjectLayout layout,
        IReadOnlyCollection<string>? ignoredPaths = null,
        IReadOnlyCollection<string>? overwritePaths = null,
        CancellationToken cancellationToken = default)
    {
        var changes = SelectChanges(plan, ignoredPaths, overwritePaths);
        var temporaryRoot = Path.Combine(Path.GetTempPath(), $"abpgen-validation-{Guid.NewGuid():N}");
        var logs = new List<string>();
        try
        {
            CopySolution(layout.SolutionRoot, temporaryRoot);
            foreach (var file in changes)
            {
                var destination = MapPath(layout.SolutionRoot, temporaryRoot, file.Path);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.WriteAllText(destination, file.Content);
            }

            foreach (var project in new[] { layout.ContractsProject, layout.ApplicationProject, layout.EntityFrameworkCoreProject })
            {
                var copiedProject = MapPath(layout.SolutionRoot, temporaryRoot, project);
                var csproj = Directory.EnumerateFiles(copiedProject, "*.csproj").Single();
                logs.Add($"> dotnet build {Path.GetFileName(csproj)} --nologo");
                using var process = new Process();
                process.StartInfo = new ProcessStartInfo("dotnet")
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WorkingDirectory = temporaryRoot
                };
                process.StartInfo.ArgumentList.Add("build");
                process.StartInfo.ArgumentList.Add(csproj);
                process.StartInfo.ArgumentList.Add("--nologo");
                if (!process.Start()) throw new InvalidOperationException("Could not start dotnet build.");
                var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
                var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
                await process.WaitForExitAsync(cancellationToken);
                logs.Add(await stdout);
                logs.Add(await stderr);
                if (process.ExitCode != 0) return new GenerationValidationResult(false, logs);
            }
            logs.Add("Generated output validation passed.");
            return new GenerationValidationResult(true, logs);
        }
        finally
        {
            if (Directory.Exists(temporaryRoot)) Directory.Delete(temporaryRoot, recursive: true);
        }
    }

    public static IReadOnlyList<string> Apply(
        GenerationPlan plan,
        string solutionRoot,
        IReadOnlyCollection<string>? ignoredPaths = null,
        IReadOnlyCollection<string>? overwritePaths = null)
    {
        var changes = SelectChanges(plan, ignoredPaths, overwritePaths);
        var journalRoot = Path.Combine(solutionRoot, ".abpgen-transactions");
        if (Directory.Exists(journalRoot) && Directory.EnumerateDirectories(journalRoot).Any())
            throw new InvalidOperationException("A previous generation transaction exists. Run 'abpgen recover' before generating again.");
        foreach (var file in changes)
        {
            _ = MapPath(solutionRoot, solutionRoot, file.Path);
            if (file.Action == PlannedFileAction.Create && File.Exists(file.Path))
                throw new IOException($"Target appeared after planning: {file.Path}");
            if (file.Action != PlannedFileAction.Create && (!File.Exists(file.Path) || !string.Equals(File.ReadAllText(file.Path), file.CurrentContent, StringComparison.Ordinal)))
                throw new IOException($"Target changed after planning: {file.Path}");
        }

        if (changes.Length == 0) return [];
        var transaction = Path.Combine(journalRoot, Guid.NewGuid().ToString("N"));
        var journal = changes.Select((file, index) => new JournalEntry(Path.GetRelativePath(solutionRoot, file.Path), File.Exists(file.Path), $"{index:D4}.bak")).ToArray();
        var logs = new List<string>();
        try
        {
            Directory.CreateDirectory(transaction);
            for (var index = 0; index < changes.Length; index++)
            {
                var file = changes[index];
                if (journal[index].Existed) File.Copy(file.Path, Path.Combine(transaction, journal[index].BackupName));
                File.WriteAllText(Path.Combine(transaction, $"{index:D4}.new"), file.Content);
            }
            File.WriteAllText(Path.Combine(transaction, "journal.json"), JsonSerializer.Serialize(journal));
            for (var index = 0; index < changes.Length; index++)
            {
                var file = changes[index];
                Directory.CreateDirectory(Path.GetDirectoryName(file.Path)!);
                File.Move(Path.Combine(transaction, $"{index:D4}.new"), file.Path, overwrite: true);
                logs.Add($"{file.Action.ToString().ToUpperInvariant()} {file.Path}");
            }
            File.WriteAllText(Path.Combine(transaction, "committed"), string.Empty);
            try { Directory.Delete(transaction, recursive: true); }
            catch (IOException) { /* A committed journal is safe to clean with recover. */ }
            return logs;
        }
        catch (Exception original)
        {
            try
            {
                if (File.Exists(Path.Combine(transaction, "journal.json"))) RecoverTransaction(solutionRoot, transaction);
                else if (Directory.Exists(transaction)) Directory.Delete(transaction, recursive: true);
            }
            catch (Exception rollback) { throw new AggregateException($"Generation failed and recovery is required in {transaction}.", original, rollback); }
            throw;
        }
    }

    public static IReadOnlyList<string> Recover(string solutionRoot)
    {
        var journalRoot = Path.Combine(solutionRoot, ".abpgen-transactions");
        if (!Directory.Exists(journalRoot)) return [];
        var logs = new List<string>();
        foreach (var transaction in Directory.EnumerateDirectories(journalRoot))
        {
            RecoverTransaction(solutionRoot, transaction);
            logs.Add($"RECOVERED {transaction}");
        }
        return logs;
    }

    private static void RecoverTransaction(string solutionRoot, string transaction)
    {
        if (!File.Exists(Path.Combine(transaction, "committed")))
        {
            var journalPath = Path.Combine(transaction, "journal.json");
            if (!File.Exists(journalPath)) throw new IOException($"Incomplete transaction has no journal: {transaction}");
            var journal = JsonSerializer.Deserialize<JournalEntry[]>(File.ReadAllText(journalPath)) ?? throw new IOException($"Invalid transaction journal: {transaction}");
            foreach (var entry in journal.Reverse())
            {
                var target = MapPath(solutionRoot, solutionRoot, Path.Combine(solutionRoot, entry.RelativePath));
                if (entry.Existed) File.Copy(Path.Combine(transaction, entry.BackupName), target, overwrite: true);
                else if (File.Exists(target)) File.Delete(target);
            }
        }
        Directory.Delete(transaction, recursive: true);
    }

    private static PlannedFile[] SelectChanges(GenerationPlan plan, IReadOnlyCollection<string>? ignoredPaths, IReadOnlyCollection<string>? overwritePaths)
    {
        var ignored = new HashSet<string>(ignoredPaths ?? [], PathComparer);
        var overwrite = new HashSet<string>(overwritePaths ?? [], PathComparer);
        var paths = plan.Files.Select(file => file.Path).ToHashSet(PathComparer);
        if (ignored.Overlaps(overwrite)) throw new InvalidOperationException("A path cannot be both kept and overwritten.");
        if (ignored.Concat(overwrite).Any(path => !paths.Contains(path))) throw new InvalidOperationException("Conflict decision contains a path outside the plan.");
        if (plan.Files.Any(file => file.Action == PlannedFileAction.Conflict && !ignored.Contains(file.Path) && !overwrite.Contains(file.Path)))
            throw new InvalidOperationException("Generation plan contains unresolved conflicts.");
        return plan.Files.Where(file => !ignored.Contains(file.Path) && (file.Action is PlannedFileAction.Create or PlannedFileAction.Update || file.Action == PlannedFileAction.Conflict && overwrite.Contains(file.Path))).ToArray();
    }

    private static string MapPath(string root, string destinationRoot, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            throw new InvalidOperationException($"Planned path is outside the solution: {path}");
        return Path.Combine(destinationRoot, relative);
    }

    private static void CopySolution(string sourceRoot, string destinationRoot)
    {
        var pending = new Stack<(string Source, string Destination)>();
        pending.Push((sourceRoot, destinationRoot));
        while (pending.Count > 0)
        {
            var (source, destination) = pending.Pop();
            Directory.CreateDirectory(destination);
            foreach (var directory in Directory.EnumerateDirectories(source))
            {
                var name = Path.GetFileName(directory);
                if (name is "bin" or "obj" or ".git" or ".vs" or "node_modules" or ".abpgen-transactions") continue;
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
                pending.Push((directory, Path.Combine(destination, name)));
            }
            foreach (var file in Directory.EnumerateFiles(source))
            {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) continue;
                File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
            }
        }
    }
}
