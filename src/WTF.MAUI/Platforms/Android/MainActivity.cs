using Android.App;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using Android.Graphics;

namespace WTF.MAUI
{
    [Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop, ScreenOrientation = ScreenOrientation.Landscape, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
    public class MainActivity : MauiAppCompatActivity
    {
        protected override void OnCreate(Bundle? savedInstanceState)
        {
            base.OnCreate(savedInstanceState);

            var window = Window;
            if (window == null)
            {
                return;
            }

            // ----------------------------------------------------
            // Status bar background color
            // ----------------------------------------------------
            window.SetStatusBarColor(
                Android.Graphics.Color.ParseColor("#FCF8F1")
            );

            // ----------------------------------------------------
            // Status bar icon/text color
            // Dark icons = LightStatusBars
            // ----------------------------------------------------
            window.InsetsController?.SetSystemBarsAppearance(
                (int)WindowInsetsControllerAppearance.LightStatusBars,
                (int)WindowInsetsControllerAppearance.LightStatusBars
            );
        }
    }
}
