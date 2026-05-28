package com.wtf.pos;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.huawei.hms.push.HmsMessageService;
import com.huawei.hms.push.RemoteMessage;
import org.json.JSONObject;

public class HuaweiPushService extends HmsMessageService {
    private static final String CHANNEL_ID = "orders";
    private static final String CHANNEL_NAME = "Orders";
    private static final String EXTRA_PATH = "huawei_push_path";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (message == null) {
            return;
        }

        String title = null;
        String body = null;
        if (message.getNotification() != null) {
            title = message.getNotification().getTitle();
            body = message.getNotification().getBody();
        }

        String path = null;
        try {
            String data = message.getData();
            if (data != null && !data.isBlank()) {
                JSONObject payload = new JSONObject(data);
                if (payload.has("path")) {
                    path = payload.getString("path");
                }
            }
        } catch (Exception ignored) {
        }

        if ((title == null || title.isBlank()) && (body == null || body.isBlank())) {
            return;
        }

        Context context = getApplicationContext();
        ensureChannel(context);

        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (path != null && !path.isBlank()) {
            intent.putExtra(EXTRA_PATH, path);
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_wtfv2)
            .setContentTitle(title == null ? "WTF POS" : title)
            .setContentText(body == null ? "" : body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify((int) System.currentTimeMillis(), builder.build());
    }

    private void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Order notifications");
        manager.createNotificationChannel(channel);
    }
}
