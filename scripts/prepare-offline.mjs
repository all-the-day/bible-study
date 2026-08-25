// scripts/prepare-offline.js — CI 用：把当前 checkout 切换为「离线版」构建配置
// 1) index.html 去掉 sync.js 引用（离线版无云同步，app.js 靠 window.BibleStudySync 缺失自动降级纯本地）
// 2) capacitor.config.json 换成离线版 appId/appName（com.allday.biblestudy.offline / 读经离线）
// 用法：在 build-apk.yml 的 offline job 中、cap sync 之前执行：node scripts/prepare-offline.js
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const htmlPath = resolve(root, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const before = html;
html = html.replace(/^\s*<script src="sync\.js"><\/script>\s*$/m, '');
if (html === before) throw new Error('index.html 未找到 sync.js 引用行，请检查');
writeFileSync(htmlPath, html);

copyFileSync(resolve(root, 'config/offline/capacitor.config.json'), resolve(root, 'capacitor.config.json'));

console.log('已切换为离线版：index.html 去掉 sync.js，capacitor 配置 -> com.allday.biblestudy.offline');
