namespace WTF.Api.Common.Auth.Permissions;

public static class PermissionRules
{
    private static readonly IReadOnlyDictionary<string, PermissionDefinition> ByKey = PermissionCatalog.All.ToDictionary(p => p.Key);

    public static bool IsKnown(string key) => ByKey.ContainsKey(key);

    public static bool IsReadKey(string key) => key.EndsWith(".read", StringComparison.Ordinal);

    // A read-only "sign in as" session keeps the keys that only look at things; every other key (write, manage, override,
    // generate, record, review, billing) is dropped.
    public static IEnumerable<string> KeepReadKeys(IEnumerable<string> keys) => keys.Where(IsReadKey);

    // Drops keys that no longer exist and adds what each key requires (a write key never exists without its read key).
    public static HashSet<string> Normalize(IEnumerable<string> keys)
    {
        var result = new HashSet<string>();
        var pending = new Stack<string>(keys.Where(IsKnown));

        while (pending.Count > 0)
        {
            var key = pending.Pop();
            if (!result.Add(key))
            {
                continue;
            }

            foreach (var required in ByKey[key].Requires)
            {
                pending.Push(required);
            }
        }

        return result;
    }
}
