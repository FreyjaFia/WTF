namespace WTF.MAUI.Navigation;

public static class Routes
{
    // ShellContent
    // - Loading Page (initial startup)
    public const string Loading = "loading";

    // - Login Page (no tab bar, no flyout)
    public const string Login = "login";

    // TabBar (Main TabBar / Bottom Navigation)
    // - New Order Tab
    public const string NewOrder = "new-order";
    // - Orders Tab
    public const string Orders = "orders";

    // Flyout (header/footer actions)
    // (No route needed for logout or header content)

    // Misc / Other pages
    public const string EditOrder = "edit-order";
}
