using Scriban;

namespace IczpNet.CodeGenerator.Core;

public static class TemplateRenderer
{
    public static string Render(string templateName, object model, string fallback)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "templates", "default", templateName);
        if (!File.Exists(path)) return fallback;
        var template = Template.Parse(File.ReadAllText(path));
        if (template.HasErrors) throw new InvalidOperationException($"Template '{templateName}' is invalid: {string.Join("; ", template.Messages)}");
        return template.Render(model, member => member.Name);
    }
}
