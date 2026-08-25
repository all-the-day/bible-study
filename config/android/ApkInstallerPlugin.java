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

/**
 * APK 安装插件：接收文件路径，经 FileProvider 交给系统安装器。
 * 由 CI 的 scripts/patch-android.mjs 注入 android/ 工程（config/android/ 为源）。
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

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
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
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
