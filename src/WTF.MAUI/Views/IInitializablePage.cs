namespace WTF.MAUI.Views;

public interface IInitializablePage
{
    // This interface is deprecated - initialization should be in ViewModels
    // Keeping for backward compatibility but will be removed
    Task InitializePageAsync();
}
