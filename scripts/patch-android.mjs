#!/usr/bin/env node
/* ============================================================
 * patch-android.mjs — CI 帮手：把 config/android/ 的原生插件注入
 * 刚 `cap add android` 生成的 android/ 工程（幂等，可重复执行）
 * 1. 拷贝 ApkInstallerPlugin.java / MainActivity.java
 * 2. 拷贝 file_paths.xml（FileProvider 路径）
 * 3. AndroidManifest.xml 幂等插入 REQUEST_INSTALL_PACKAGES + queries + provider
 * ============================================================ */
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "config", "android");
const ANDROID = join(ROOT, "android");

if (!existsSync(join(ANDROID, "app"))) {
  console.error("android/ 工程不存在（先运行 npx cap add android）");
  process.exit(1);
}

/* 1. Java 源码 → app/src/main/java/com/allday/biblestudy/ */
const javaDir = join(ANDROID, "app", "src", "main", "java", "com", "allday", "biblestudy");
mkdirSync(javaDir, { recursive: true });
cpSync(join(SRC, "ApkInstallerPlugin.java"), join(javaDir, "ApkInstallerPlugin.java"));
cpSync(join(SRC, "MainActivity.java"), join(javaDir, "MainActivity.java"));
console.log("✓ ApkInstallerPlugin.java / MainActivity.java");

/* 2. file_paths.xml → app/src/main/res/xml/ */
const xmlDir = join(ANDROID, "app", "src", "main", "res", "xml");
mkdirSync(xmlDir, { recursive: true });
cpSync(join(SRC, "file_paths.xml"), join(xmlDir, "file_paths.xml"));
console.log("✓ file_paths.xml");

/* 3. AndroidManifest.xml：权限 + queries + FileProvider（幂等） */
const manifestPath = join(ANDROID, "app", "src", "main", "AndroidManifest.xml");
let manifest = readFileSync(manifestPath, "utf8");

const PERMISSION = '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />';
const QUERIES = `    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="application/vnd.android.package-archive" />
        </intent>
    </queries>`;
const PROVIDER = `    <provider
        android:name="androidx.core.content.FileProvider"
        android:exported="false"
        android:authorities="com.allday.biblestudy.fileprovider"
        android:grantUriPermissions="true">
        <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/file_paths" />
    </provider>`;

const insertBefore = (text, anchor, block) => {
  if (text.includes(block)) return text;   // 幂等：block 已存在则跳过
  return text.replace(anchor, block + "\n" + anchor);
};

if (!manifest.includes("REQUEST_INSTALL_PACKAGES")) {
  manifest = manifest.replace("</manifest>", PERMISSION + "\n</manifest>");
}
if (!manifest.includes("<queries>")) {
  manifest = insertBefore(manifest, "<application", QUERIES + "\n");
}
if (!manifest.includes("com.allday.biblestudy.fileprovider")) {
  manifest = manifest.replace("</application>", PROVIDER + "\n    </application>");
}
writeFileSync(manifestPath, manifest);
console.log("✓ AndroidManifest.xml（权限/queries/provider）");
console.log("patch-android 完成");
