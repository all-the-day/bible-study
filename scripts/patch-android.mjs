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
let manifest = readFileSync(manifestPath, "utf8");const PERMISSION = '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />';
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

/* 4. 固定 debug 签名：改写 app/build.gradle 的 signingConfigs.debug，
     指向仓库内 keystore（绝对路径 + 显式密码，幂等）——CI 每次全新 runner，
     不固定签名会导致每次构建 keystore 不同、覆盖安装必须卸载重装 */
const gradlePath = join(ANDROID, "app", "build.gradle");
const ksPath = join(ROOT, "config", "android", "debug.keystore").replace(/\\/g, "/");
let gradle = readFileSync(gradlePath, "utf8");
const debugSignBlock = `debug {
            storeFile file("${ksPath}")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }`;
if (/storeFile\s+file\(/.test(gradle)) {
  // 已有 storeFile：替换路径 + 补全密码/别名
  gradle = gradle.replace(/storeFile\s+file\([^)]*\)/, `storeFile file("${ksPath}")`);
  if (!/storePassword/.test(gradle)) {
    gradle = gradle.replace(
      /storeFile\s+file\([^)]*\)/,
      `storeFile file("${ksPath}")\n            storePassword "android"\n            keyAlias "androiddebugkey"\n            keyPassword "android"`
    );
  }
} else if (gradle.includes("signingConfigs")) {
  // 有 signingConfigs 但无 storeFile：插入 debug 条目
  gradle = gradle.replace(/signingConfigs\s*\{/, `signingConfigs {\n        ${debugSignBlock}`);
} else {
  // 无 signingConfigs：在 android 块内插入
  gradle = gradle.replace(/android\s*\{/, `android {\n    signingConfigs {\n        ${debugSignBlock}\n    }`);
}
writeFileSync(gradlePath, gradle);
const shown = gradle.match(/signingConfigs\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
console.log("✓ build.gradle 固定签名配置：\n" + shown);
console.log("patch-android 完成");
