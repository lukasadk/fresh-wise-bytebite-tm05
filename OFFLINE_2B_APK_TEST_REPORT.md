# WasteWise 2B 离线 APK 实际验收报告

日期：2026-09-08

## 结论

Qwen3-VL 2B 蒸馏 MNN 模型已经作为本地资源打入 FreshWise Android arm64 APK，应用端包含离线图片解码、离线 Latin OCR、MNN 多模态推理、保守 JSON 修复、字段证据校验以及逐项用户确认流程。可安装的 Release 测试包已生成，但仍使用 Android Debug 证书，且没有真机连接，因此当前结论是“静态构建和包完整性通过，真机推理待验收”。该 APK 构建时没有可用的 `EXPO_PUBLIC_API_KEY`；离线识别不受影响，但向当前 Railway 后端确认入库会返回 HTTP 401，配置匹配的客户端 Key 并重新构建前只能视为 recognition-only 包。

该 2B 模型此前没有通过项目的识别质量门槛，部署等级保持为 `experimental_only_acceptance_failed`，不得据此启用无人确认的自动入库。

## 本次问题修复

- 对缺失键引号、尾随逗号和完整 JSON 对象之后多余的右括号做有限、可审计的修复。
- 不尝试挽救重复左花括号或无法确定边界的破损输出；这种输出直接拒绝。
- `brand`、`product_variant`、`net_content_text` 和日期字段必须获得 Android 端独立 OCR 文本支持。
- 模型自报的 `packaging_text_evidence` 不再被当作独立证据。
- OCR 没有读到净含量时，模型虚构的 `100 g` 会被置空并要求复核。
- 完全重复的模型行会折叠，但不再相加数量，避免重复生成导致数量膨胀。
- 每一个识别候选仍须由用户编辑、保留或拒绝并确认，之后才能进入 Active Inventory。

## 交付 APK

- 文件：`D:\fresh-wise-bytebite-tm05\artifacts\WasteWise-FreshWise-offline-2B-experimental-20260908-v1-release-test.apk`
- 大小：1,473,592,360 bytes
- SHA-256：`477218e865b168a3a075c8be71659fd32c62e9fa5319ca9b85195c7afca6a081`
- 包名：`com.bytebite.freshwise`
- 版本：`1.1.0`（versionCode 1）
- 最低系统：Android API 24
- CPU 架构：仅 `arm64-v8a`
- JavaScript：Release bundle 已嵌入 APK，不依赖 Metro 开发服务器。
- 签名：APK Signature Scheme v2 验证通过；签名者为 Android Debug 证书，仅限本地测试。

保留的构建产物：

- Debug 离线包：`D:\fresh-wise-bytebite-tm05\artifacts\WasteWise-FreshWise-offline-2B-experimental-20260908-v1.apk`，1,500,095,126 bytes，SHA-256 `1d725b81fc96482f735745c65eb7af3fef1aecb70e37f117da453a5da8e86195`。
- 集成前 Debug 归档：`D:\fresh-wise-bytebite-tm05\artifacts\archive\app-debug-before-offline-mnn-20260908.apk`，64,607,277 bytes，SHA-256 `9dc28d9dda7db20f23482abd204b23f2710b79e903196c8d08ee6886f33b0b8b`。

## 模型包审计

- 模型版本：`qwen3-vl-2b-distilled-int4-v8-20260908-v1`
- 量化：语言权重 INT4，视觉权重 INT8（实验）
- MNN 源码提交：`bef71b9756a2c77549eddbe33eb97290e3b16602`
- 7 个模型文件总大小：1,415,395,508 bytes
- 本地模型清单与 4090 服务器原件的 7 个 SHA-256 全部一致。
- Release APK 内再次流式校验 7 个模型文件：大小 7/7 通过，SHA-256 7/7 通过。
- `.mnn`、`.weight` 和 `.mtok` 大文件在 APK 内均为未压缩存储。
- APK 内确认存在 `libMNN.so`、`libwastewise_vlm.so`、`libmlkit_google_ocr_pipeline.so` 和 bundled Latin OCR 模型资源。
- APK 中没有检测到其他 ABI 的原生库。

## 实际测试结果

| 检查 | 结果 |
| --- | --- |
| TypeScript JSON/字段校验测试 | 8 passed，0 failed |
| TypeScript `tsc --noEmit` | passed |
| `metro.config.js` 语法检查 | passed |
| Python 后端解析回归 | 11 passed，0 failed，1 个 Starlette/httpx 弃用警告 |
| WasteWise 原生 Android AAR 构建 | passed |
| Debug APK 构建 | passed |
| Release 首次构建 | failed：pnpm 外置虚拟存储导致 Metro 无法解析 React |
| Metro 路径修复后的 Release 构建 | passed；2,707 modules，37 assets 已嵌入 |
| Release APK zipalign | passed |
| Release APK v2 签名验证 | passed |
| Release APK 包内模型完整性 | 7/7 size + SHA-256 passed |
| Railway `/health` | HTTP 200，`{"status":"ok"}` |
| Railway 业务接口（无 API Key 的只读探测） | HTTP 401，确认当前构建缺少所需配置 |
| Android 真机安装、启动、OCR/MNN 推理与耗时 | 未执行：`adb devices -l` 未发现设备 |

测试过程中出现的 Gradle/第三方依赖弃用警告没有导致构建失败；没有把这些警告记录成模型识别实验结果。

## 使用与剩余验收

侧载测试命令：

```powershell
adb install -r "D:\fresh-wise-bytebite-tm05\artifacts\WasteWise-FreshWise-offline-2B-experimental-20260908-v1-release-test.apk"
```

首先在 Git-ignored 的 `D:\fresh-wise-bytebite-tm05\.env` 中填写与 Railway `API_KEY` 相同的 `EXPO_PUBLIC_API_KEY`，再重新构建 Release APK。首次准备模型时，应用会把约 1.4 GB 资源复制到应用私有目录并逐文件校验 SHA-256，因此设备需同时容纳 APK 和提取后的模型副本。真机验收至少还应覆盖：安装成功、冷启动、首次模型复制、三张样例照片、OCR 对 `100 g` 的否决逻辑、内存峰值、单图时延和用户确认入库。未完成这些项目之前，不应把此包描述为生产可用。

模型和 APK 均被 `.gitignore` 排除，本次没有向远端仓库上传任何本地权重或构建产物。
