package com.wtf.pos.plugins;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.huawei.agconnect.config.AGConnectServicesConfig;
import com.huawei.hms.aaid.HmsInstanceId;
import com.huawei.hms.api.HuaweiApiAvailability;
import com.huawei.hms.api.ConnectionResult;

@CapacitorPlugin(name = "HuaweiPush")
public class HuaweiPushPlugin extends Plugin {
    @PluginMethod
    public void isAvailable(PluginCall call) {
        Context context = getContext();
        int status = HuaweiApiAvailability.getInstance().isHuaweiMobileServicesAvailable(context);
        boolean available = status == ConnectionResult.SUCCESS;
        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        Context context = getContext();
        new Thread(() -> {
            try {
                String appId = getConfiguredAppId(context);

                if (appId == null || appId.isBlank()) {
                    call.reject("Huawei app_id not configured. Ensure agconnect-services.json is present.");
                    return;
                }

                String token = HmsInstanceId.getInstance(context).getToken(appId, "HCM");
                JSObject result = new JSObject();
                result.put("token", token);
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Failed to obtain Huawei push token.", ex);
            }
        }).start();
    }

    private String getConfiguredAppId(Context context) throws PackageManager.NameNotFoundException {
        String appId = AGConnectServicesConfig
            .fromContext(context)
            .getString("client/app_id");

        if (appId != null && !appId.isBlank()) {
            return appId;
        }

        ApplicationInfo appInfo = context
            .getPackageManager()
            .getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);

        String manifestAppId = appInfo.metaData == null
            ? null
            : appInfo.metaData.getString("com.huawei.hms.client.appid");

        if (manifestAppId != null && manifestAppId.startsWith("appid=")) {
            return manifestAppId.substring("appid=".length());
        }

        return manifestAppId;
    }
}
