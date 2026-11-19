using System.Collections.Generic;
using System.Linq;

namespace Shop.Util;

public static class StringExtensions
{
    public static string Truncate(this string s, int max) => s.Length <= max ? s : s.Substring(0, max);

    public static bool IsBlank(this string? s) => string.IsNullOrWhiteSpace(s);

    // The library's own string.Contains(char) is an instance method, so it must win over this.
    public static bool Contains(this IEnumerable<char> chars, char c) => chars.Any(x => x == c);
}
