package com.allday.biblestudy;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * APK 更新插件：
 * - download(url)：原生 HTTP 下载 APK 到 cacheDir/downloads/（不受 WebView CORS 限制），
 *   自动跟随重定向（GitHub 302 → release-assets），连接/读取停滞超时，按 content-length
 *   节流上报 progress 事件（fraction 0..1）；失败 reject 错误信息供 JS 切换镜像源。
 * - install(filePath)：接收文件路径，经 FileProvider 交给系统安装器。
 * 由 CI 的 scripts/patch-android.mjs 注入 android/ 工程（config/android/ 为源）。
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 8000; // 连接/首字节超时（对齐 update.js 原 CONNECT_TIMEOUT）
    private static final int READ_TIMEOUT_MS = 15000;   // 读取停滞超时：N 秒无任何数据（对齐 STALL_TIMEOUT）
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String FILE_NAME = "bible-study-update.apk";
    private static final long PROGRESS_INTERVAL_MS = 500; // 进度事件节流

    @PluginMethod
    public void download(PluginCall pluginCall) {
        String url = pluginCall.getString("url");
        if (url == null || url.isEmpty()) {
            pluginCall.reject("下载地址不能为空");
            return;
        }
        // 后台线程下载，避免阻塞 WebView 主线程
        new Thread(() -> {
            try {
                File out = downloadToFile(url);
                JSObject ret = new JSObject();
                ret.put("uri", out.getAbsolutePath());
                pluginCall.resolve(ret);
            } catch (Exception e) {
                pluginCall.reject(e.getMessage() == null ? "下载失败" : e.getMessage());
            }
        }).start();
    }

    private File downloadToFile(String urlStr) throws IOException {
        HttpURLConnection conn = null;
        InputStream in = null;
        FileOutputStream out = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true); // 跟随 GitHub 302 → release-assets
            conn.setRequestProperty("Accept", APK_MIME);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) BibleStudy");

            int code = conn.getResponseCode(); // 触发连接 + 首字节
            if (code != 200) {
                throw new IOException("HTTP " + code);
            }
            long total = conn.getContentLengthLong();

            File dir = new File(getContext().getCacheDir(), "downloads");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("无法创建下载目录");
            }
            File file = new File(dir, FILE_NAME);
            out = new FileOutputStream(file);
            in = conn.getInputStream();

            byte[] buf = new byte[64 * 1024];
            long received = 0;
            long lastReport = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                received += n;
                long now = System.currentTimeMillis();
                // 节流上报进度；上限 95%（完成时由 JS 置 100%）
                if (total > 0 && now - lastReport >= PROGRESS_INTERVAL_MS) {
                    lastReport = now;
                    reportProgress(Math.min((double) received / total, 0.95));
                }
            }
            out.flush();
            out.close();
            out = null;
            in.close();
            in = null;
            reportProgress(1.0);
            return file;
        } finally {
            try {
                if (out != null) out.close();
            } catch (IOException ignored) {
            }
            try {
                if (in != null) in.close();
            } catch (IOException ignored) {
            }
            if (conn != null) conn.disconnect();
        }
    }

    private void reportProgress(double fraction) {
        JSObject data = new JSObject();
        data.put("fraction", fraction);
        notifyListeners("progress", data);
    }

    @PluginMethod
    public void install(PluginCall pluginCall) {
        String filePath = pluginCall.getString("filePath");
        if (filePath == null || filePath.isEmpty()) {
            pluginCall.reject("文件路径不能为空");
            return;
        }
        try {
            if (filePath.startsWith("file://")) {
                filePath = filePath.substring(7);
            }
            File file = new File(filePath);
            if (!file.exists()) {
                pluginCall.reject("文件不存在: " + filePath);
                return;
            }
            Uri uri;
            if (Build.VERSION.SDK_INT >= 24) {
                uri = FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".fileprovider", file);
            } else {
                uri = Uri.fromFile(file);
            }
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("message", "安装程序已打开");
            pluginCall.resolve(ret);
        } catch (Exception e) {
            pluginCall.reject("打开安装程序失败: " + e.getMessage());
        }
    }
}
