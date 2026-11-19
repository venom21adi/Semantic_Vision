namespace Shop;

public static class Platform
{
#if NET6_0_OR_GREATER
    public static string Name() => Modern();

    private static string Modern() => "modern";
#else
    public static string Name() => Legacy();

    private static string Legacy() => "legacy";
#endif
}
