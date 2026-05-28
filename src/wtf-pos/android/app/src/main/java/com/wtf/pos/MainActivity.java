package com.wtf.pos;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.wtf.pos.plugins.HuaweiPushPlugin;

public class MainActivity extends BridgeActivity {
    private static final String HUAWEI_PUSH_PATH_EXTRA = "huawei_push_path";
    private static final int ROUTE_RETRY_COUNT = 10;
    private static final int ROUTE_RETRY_DELAY_MS = 500;
    private String pendingHuaweiPath;
    private int pendingHuaweiRetries;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(HuaweiPushPlugin.class);

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

        handleHuaweiPushIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        handleHuaweiPushIntent(intent);
    }

    private void handleHuaweiPushIntent(android.content.Intent intent) {
        if (intent == null) {
            return;
        }

        String path = intent.getStringExtra(HUAWEI_PUSH_PATH_EXTRA);
        if (path == null || path.isBlank()) {
            return;
        }

        pendingHuaweiPath = path;
        pendingHuaweiRetries = 0;
        tryNavigateToPendingPath();
    }

    private void tryNavigateToPendingPath() {
        if (pendingHuaweiPath == null || pendingHuaweiPath.isBlank()) {
            return;
        }

        WebView webView = getBridge().getWebView();
        String safePath = pendingHuaweiPath.replace("'", "\\'");
        String js = "document.readyState";
        webView.evaluateJavascript(js, value -> {
            boolean ready = "\"complete\"".equals(value) || "\"interactive\"".equals(value);
            if (!ready && pendingHuaweiRetries < ROUTE_RETRY_COUNT) {
                pendingHuaweiRetries++;
                webView.postDelayed(this::tryNavigateToPendingPath, ROUTE_RETRY_DELAY_MS);
                return;
            }

            String nav = "window.location.assign('" + safePath + "');";
            webView.evaluateJavascript(nav, null);
            pendingHuaweiPath = null;
        });
    }
}
