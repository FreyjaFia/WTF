package com.wtf.pos;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // On Android 15+/16+ edge-to-edge is enforced, so the WebView sits
        // behind the status bar. Read the real inset height and inject it as
        // a CSS variable so Angular can pad the layout accordingly.
        WebView webView = getBridge().getWebView();

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            float density = getResources().getDisplayMetrics().density;
            int topDp = Math.round(insets.top / density);
            int bottomDp = Math.round(insets.bottom / density);

            String js = "document.documentElement.style.setProperty('--safe-area-top','" + topDp + "px');"
                    + "document.documentElement.style.setProperty('--safe-area-bottom','" + bottomDp + "px');";

            webView.postDelayed(() -> webView.evaluateJavascript(js, null), 500);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
