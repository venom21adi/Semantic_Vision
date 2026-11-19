// Generates src/semantic_vision/resolver/data/bcl_members.json.gz: for every public type of the
// .NET shared framework, the names of its public *instance* methods (inherited ones included).
//
// The C# resolver uses it to answer "does this library type already have a method with this name?".
// That decides a real ambiguity: when a repo declares an extension method `Contains(this ...)` and
// code calls `text.Contains("x")`, the compiler binds the library's own instance method, never the
// extension. Without this table the resolver cannot tell the two apart for a library receiver.
//
// Usage: dotnet run --project scripts/csharp/bcl_members -- <output.json.gz>
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;

var outPath = args.Length > 0 ? args[0] : "bcl_members.json.gz";
var frameworkDir = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
var members = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);

foreach (var path in Directory.EnumerateFiles(frameworkDir, "*.dll"))
{
    Assembly asm;
    try
    {
        // The core library is already loaded by the runtime; loading it again by path fails.
        var loaded = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => !a.IsDynamic && string.Equals(a.Location, path, StringComparison.OrdinalIgnoreCase));
        asm = loaded ?? Assembly.LoadFrom(path);
    }
    catch { continue; }
    Type[] types;
    try { types = asm.GetExportedTypes(); } catch { continue; }
    foreach (var t in types)
    {
        if (t.IsGenericParameter) continue;
        var name = t.Name;
        var tick = name.IndexOf('`');
        if (tick >= 0) name = name[..tick];
        var names = new HashSet<string>();
        try
        {
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.Instance))
                if (!m.IsSpecialName) names.Add(m.Name);
            if (t.IsInterface)
                foreach (var i in t.GetInterfaces())
                    foreach (var m in i.GetMethods(BindingFlags.Public | BindingFlags.Instance))
                        if (!m.IsSpecialName) names.Add(m.Name);
        }
        catch { continue; }
        if (names.Count == 0) continue;
        if (!members.TryGetValue(name, out var set)) members[name] = set = new SortedSet<string>(StringComparer.Ordinal);
        set.UnionWith(names);
    }
}

var json = JsonSerializer.SerializeToUtf8Bytes(members.ToDictionary(k => k.Key, k => k.Value.ToArray()));
using var fs = File.Create(outPath);
using var gz = new GZipStream(fs, CompressionLevel.SmallestSize);
gz.Write(json);
Console.WriteLine($"{members.Count} types, {members.Values.Sum(v => v.Count)} method names, {new FileInfo(outPath).Length / 1024} KB gz (framework {Environment.Version})");
