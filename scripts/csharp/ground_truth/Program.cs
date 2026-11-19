// Ground truth for C# call resolution: the real compiler's answer for every call site.
//
// Parses every .cs file under <root> with Roslyn, binds it against the .NET framework
// reference assemblies, and writes one JSON line per call site (method invocations, object
// creations, constructor initializers) with the method the compiler resolved it to and
// whether that method is declared in the repository's own source.
//
// Types from NuGet packages are not available, so a call that depends on one cannot bind
// ("unbound" below). Those sites are reported but excluded from accuracy numbers, since the
// compiler has no answer to compare against.
//
// Usage: dotnet run --project scripts/csharp/ground_truth -c Release -- <root> <out.jsonl> [SYMBOL ...]
// SYMBOL arguments are preprocessor symbols to define (see validate.py, which passes the same
// set the analyzer treats as defined so both look at the same `#if` branches).
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var root = Path.GetFullPath(args[0]);
var outPath = args[1];
var symbols = args.Skip(2).ToArray();
var skipDirs = new HashSet<string> { "bin", "obj", ".git", "node_modules" };

var files = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
    .Where(f => !Path.GetRelativePath(root, f).Split(Path.DirectorySeparatorChar)
        .Any(p => skipDirs.Contains(p) || p.StartsWith('.')))
    .OrderBy(f => f, StringComparer.Ordinal)
    .ToList();

var parse = new CSharpParseOptions(LanguageVersion.Latest, DocumentationMode.None, SourceCodeKind.Regular, symbols);
var trees = files.Select(f => CSharpSyntaxTree.ParseText(File.ReadAllText(f), parse, path: f)).ToList();
var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!)
    .Split(Path.PathSeparator)
    .Select(p => (MetadataReference)MetadataReference.CreateFromFile(p))
    .ToList();
var compilation = CSharpCompilation.Create(
    "ground_truth",
    trees,
    references,
    new CSharpCompilationOptions(
        OutputKind.DynamicallyLinkedLibrary,
        allowUnsafe: true,
        nullableContextOptions: NullableContextOptions.Enable));

string Relative(string path) =>
    Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');

using var writer = new StreamWriter(outPath);
int sites = 0, internalSites = 0, unbound = 0;

foreach (var tree in trees)
{
    var model = compilation.GetSemanticModel(tree);
    var file = Relative(tree.FilePath);
    foreach (var node in tree.GetRoot().DescendantNodes())
    {
        string kind, name;
        switch (node)
        {
            case InvocationExpressionSyntax invocation:
                kind = "call";
                name = invocation.Expression switch
                {
                    MemberAccessExpressionSyntax m => m.Name.Identifier.ValueText,
                    MemberBindingExpressionSyntax b => b.Name.Identifier.ValueText,
                    IdentifierNameSyntax i => i.Identifier.ValueText,
                    GenericNameSyntax g => g.Identifier.ValueText,
                    _ => "",
                };
                if (name == "nameof") continue;
                break;
            case ObjectCreationExpressionSyntax:
            case ImplicitObjectCreationExpressionSyntax:
                kind = "new";
                name = ".ctor";
                break;
            case ConstructorInitializerSyntax initializer:
                kind = "init";
                name = initializer.ThisOrBaseKeyword.ValueText;
                break;
            default:
                continue;
        }

        sites++;
        var info = model.GetSymbolInfo(node);
        var symbol = info.Symbol ?? info.CandidateSymbols.FirstOrDefault();
        var line = tree.GetLineSpan(node.Span).StartLinePosition.Line + 1;

        if (symbol is not IMethodSymbol method)
        {
            unbound++;
            writer.WriteLine(JsonSerializer.Serialize(new { file, line, kind, name, bound = false }));
            continue;
        }

        // An extension method called as `x.M()` is reported as the static method it is.
        var declared = (method.ReducedFrom ?? method).OriginalDefinition;
        var location = declared.Locations.FirstOrDefault(l => l.IsInSource);
        var inSource = location != null &&
            SymbolEqualityComparer.Default.Equals(declared.ContainingAssembly, compilation.Assembly);
        if (inSource) internalSites++;

        writer.WriteLine(JsonSerializer.Serialize(new
        {
            file,
            line,
            kind,
            name,
            bound = true,
            @internal = inSource,
            ambiguous = info.Symbol == null,
            targetType = declared.ContainingType?.Name ?? "",
            targetName = declared.MethodKind == MethodKind.Constructor ? ".ctor" : declared.Name,
            targetFile = inSource ? Relative(location!.SourceTree!.FilePath) : "",
            targetLine = inSource ? location!.GetLineSpan().StartLinePosition.Line + 1 : 0,
            externalType = inSource ? "" : (declared.ContainingType?.Name ?? ""),
        }));
    }
}

Console.WriteLine($"{files.Count} files, {sites} call sites, {internalSites} internal, {unbound} unbound");
