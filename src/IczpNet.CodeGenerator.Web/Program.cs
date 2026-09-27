using IczpNet.CodeGenerator.Core;
using IczpNet.CodeGenerator.Roslyn;
using IczpNet.CodeGenerator.Web;
using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);
var targetProject = ResolveProject(args);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.AllowAnyHeader().AllowAnyMethod().AllowAnyOrigin()));
var app = builder.Build();
Console.WriteLine($"ABP Generator Studio is serving target project: {targetProject}");
app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/project", () => Results.Ok(new { project = targetProject }));
app.MapGet("/api/entities", () => Results.Ok(EntityScanner.Scan(targetProject)));
app.MapGet("/api/entities/{entity}", (string entity) => Results.Ok(FindEntity(targetProject, entity)));
app.MapGet("/api/entities/{entity}/descriptor", (string entity) =>
{
    var model = FindEntity(targetProject, entity);
    var document = DescriptorStore.LoadDocument(targetProject, model.Name);
    var descriptor = document.Descriptor ?? CreateDefaultDescriptor(model);
    return Results.Ok(new { descriptor, document.Format, sourceProperties = model.Properties, raw = DescriptorStore.Serialize(descriptor, document.Format) });
});
app.MapPut("/api/entities/{entity}/descriptor", (string entity, DescriptorUpdateRequest request) =>
{
    var model = FindEntity(targetProject, entity);
    var document = DescriptorStore.LoadDocument(targetProject, model.Name);
    var allowedProperties = model.Properties.Select(x => x.Name).ToHashSet(StringComparer.Ordinal);
    var unsupported = request.Descriptor.Properties.Keys.Where(x => !allowedProperties.Contains(x)).ToArray();
    if (unsupported.Length > 0) return Results.BadRequest(new { message = $"Unknown entity properties: {string.Join(", ", unsupported)}" });

    var descriptor = new EntityDescriptor
    {
        Entity = model.FullName,
        Profile = request.Descriptor.Profile,
        Crud = request.Descriptor.Crud,
        Permissions = request.Descriptor.Permissions,
        DefaultSorting = request.Descriptor.DefaultSorting,
        Construction = request.Descriptor.Construction,
        Update = request.Descriptor.Update,
        Properties = request.Descriptor.Properties
    };
    var errors = DescriptorValidator.Validate(model, descriptor);
    if (errors.Count > 0) return Results.BadRequest(new { message = string.Join(" ", errors) });
    DescriptorStore.SaveDocument(document, descriptor, request.Format ?? document.Format);
    var format = request.Format ?? document.Format;
    return Results.Ok(new { descriptor, format, raw = DescriptorStore.Serialize(descriptor, format) });
});
app.MapPut("/api/entities/{entity}/descriptor/raw", (string entity, RawDescriptorUpdateRequest request) =>
{
    var model = FindEntity(targetProject, entity);
    var document = DescriptorStore.LoadDocument(targetProject, model.Name);
    var format = request.Format ?? document.Format;
    var descriptor = DescriptorStore.Parse(request.Content, format);
    if (descriptor is null) return Results.BadRequest(new { message = "Descriptor content is empty or invalid." });
    if (!string.Equals(descriptor.Entity, model.FullName, StringComparison.Ordinal))
        return Results.BadRequest(new { message = $"Descriptor entity must be '{model.FullName}'." });

    var errors = DescriptorValidator.Validate(model, descriptor);
    if (errors.Count > 0) return Results.BadRequest(new { message = string.Join(" ", errors) });

    var allowedProperties = model.Properties.Select(x => x.Name).ToHashSet(StringComparer.Ordinal);
    var unsupported = descriptor.Properties.Keys.Where(x => !allowedProperties.Contains(x)).ToArray();
    if (unsupported.Length > 0) return Results.BadRequest(new { message = $"Unknown entity properties: {string.Join(", ", unsupported)}" });

    DescriptorStore.SaveRawDocument(document, request.Content, format);
    return Results.Ok(new { descriptor, format, raw = request.Content });
});
app.MapPost("/api/generation/plan", (GenerationRequest request) => Results.Ok(CreatePlan(request)));
app.MapPost("/api/generation/generate", async (GenerationRequest request) =>
{
    var plan = CreatePlan(request);
    var root = string.IsNullOrWhiteSpace(request.Project) ? targetProject : Path.GetFullPath(request.Project);
    var entity = FindEntity(root, request.Entity);
    var layout = AbpProjectLayoutResolver.Resolve(root, entity);
    GenerationValidationResult validation;
    try { validation = await GenerationWorkflow.ValidateAsync(plan, layout, request.IgnoredPaths, request.OverwritePaths); }
    catch (InvalidOperationException exception) { return Results.Conflict(new ExecutionResult(false, [exception.Message], plan)); }
    if (!validation.Succeeded) return Results.Ok(new ExecutionResult(false, validation.Logs, plan));
    try
    {
        var writes = GenerationWorkflow.Apply(plan, layout.SolutionRoot, request.IgnoredPaths, request.OverwritePaths);
        return Results.Ok(new ExecutionResult(true, validation.Logs.Concat(writes).ToArray(), plan));
    }
    catch (Exception exception) when (exception is IOException or InvalidOperationException or AggregateException)
    { return Results.Conflict(new ExecutionResult(false, [exception.Message], plan)); }
});
app.MapPost("/api/generation/validate", async (GenerationRequest request) =>
{
    var root = string.IsNullOrWhiteSpace(request.Project) ? targetProject : Path.GetFullPath(request.Project);
    var entity = FindEntity(root, request.Entity);
    var layout = AbpProjectLayoutResolver.Resolve(root, entity);
    var plan = CreatePlan(request);
    GenerationValidationResult validation;
    try { validation = await GenerationWorkflow.ValidateAsync(plan, layout); }
    catch (InvalidOperationException exception) { return Results.Conflict(new ExecutionResult(false, [exception.Message], plan)); }
    return Results.Ok(new ExecutionResult(validation.Succeeded, validation.Logs, plan));
});
app.MapPost("/api/generation/format", (GenerationRequest request) =>
{
    var plan = CreatePlan(request);
    return Results.Ok(new ExecutionResult(!plan.HasConflicts, ["Generated source templates are emitted in normalized C# formatting.", "Formatting preview refreshed; no target files were modified."], plan));
});

app.MapFallbackToFile("index.html");
app.Run();

GenerationPlan CreatePlan(GenerationRequest request)
{
    var root = string.IsNullOrWhiteSpace(request.Project) ? targetProject : Path.GetFullPath(request.Project);
    var entity = FindEntity(root, request.Entity);
    return GenerationService.CreateDtoPlan(entity, AbpProjectLayoutResolver.Resolve(root, entity), DescriptorStore.Load(root, entity.Name));
}

static EntityModel FindEntity(string root, string requested)
{
    var matches = EntityScanner.Scan(root).Where(x => x.Name == requested || x.FullName == requested).ToArray();
    return matches.Length switch
    {
        1 => matches[0],
        0 => throw new InvalidOperationException($"Entity '{requested}' was not found."),
        _ => throw new InvalidOperationException($"Entity '{requested}' is ambiguous.")
    };
}

static string ResolveProject(string[] args)
{
    var index = Array.IndexOf(args, "--project");
    var project = index >= 0 && index + 1 < args.Length ? args[index + 1] : Directory.GetCurrentDirectory();
    return Path.GetFullPath(project);
}

static EntityDescriptor CreateDefaultDescriptor(EntityModel model) => new()
{
    Entity = model.FullName,
    Properties = model.Properties.Where(x => !x.IsSystemManaged).ToDictionary(x => x.Name, _ => new PropertyDescriptor(), StringComparer.Ordinal)
};
