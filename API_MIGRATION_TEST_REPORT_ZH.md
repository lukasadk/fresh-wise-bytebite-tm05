# FreshWise 4B API 迁移与实测报告

日期：2026-09-13

## 结论

手机端已经从内置 2B/MNN 离线模型改为调用 WasteWise FastAPI 网关。APK
不再携带模型权重；以后只需在服务器配置一个 OpenAI-compatible 的开源
Qwen3-VL-4B 服务，手机端无需知道模型供应端密钥。

当前 4B 服务尚未配置，所以本报告不宣称真实照片或小票识别已通过。未配置
时界面显示 “The AI service still needs server setup.”，不会填充演示数据或伪造
识别结果。

## 已完成能力

- 商品照片上传：`POST /v1/api-recognition/analyze`
- 超市小票扫描：`POST /v1/api-recognition/receipt`
- 规则型预计过期日期：`POST /v1/expiry-estimates`
- 商品照片仅在模型返回可靠归一化坐标时绘制名称框；小票不伪造商品位置。
- 确认表格只显示并允许编辑：商品名称、预计过期日期、数量。
- 手动添加页面也只保留上述三个输入项。
- 识别候选仍须用户勾选、编辑和确认后才进入库存。
- 图片中真实可读的 `expiry_date_candidate` 与规则估算的
  `estimated_expiry_date` 分离；估算日期在界面标记为 `EST.`。

## 实际测试结果

### 后端

- `pytest -q`：180 passed，1 warning，耗时 19.11 秒。
- warning 为 FastAPI TestClient 使用的 Starlette/httpx 弃用提示，不是测试失败。
- `/health`：HTTP 成功，后端状态 ready；当前本地模型未加载。
- `/v1/api-recognition/config`：两个提示词均成功加载，模型固定为开源基座
  `qwen3-vl-4b-instruct`；因为尚未填写该密钥签发平台的 4B 地址，
  `enabled=false`，符合预期。
- 过期日期 smoke test：以 2026-09-13 为参考日，`UHT full cream milk` 命中
  180 天规则并返回 2027-03-12；这是确定性规则输出，不是模型读取出的包装日期。

### 手机端与网页

- TypeScript `tsc --noEmit`：通过。
- Node 测试：23 passed，0 failed，耗时 282.91 ms。
- 浏览器实测：商品照片/小票标签可切换；标题、拍照/图库按钮和未配置状态均
  正常；页面不再展示内部模型版本名称。
- 前端环境审计：模型供应端密钥未写入 APK 配置；两个前端 service/API key
  均为空。4B 的地址、模型名和可选密钥只由 FastAPI 服务器持有。
- Node 仅报告 package module type 性能提示，没有测试失败。

### Android Release

- Gradle `:app:assembleRelease`：BUILD SUCCESSFUL in 8m 49s。
- 708 actionable tasks，708 executed。
- 包名：`com.bytebite.freshwise`
- 版本：versionCode 18，versionName 1.4.0。
- minSdk 24，targetSdk 36，ABI arm64-v8a。
- APK：`artifacts/WasteWise-FreshWise-API-v1.4.0-release-test.apk`
- 大小：38,695,326 字节（约 36.9 MiB）。
- SHA-256：`135EF7E9A771BB205D00576A169E4D1629BDEE9134236F391C01DD5C0DD62CB7`
- APK Signature Scheme v2：通过。
- 当前签名为 Android Debug 测试证书，只适合侧载测试，不适合应用商店发布。
- 对 APK 的 1,215 个条目执行名称审计，未发现 `.mnn`、Qwen、2B、
  `wastewise-vlm`、模型权重或 `tokenizer.mtok`。
- 局域网 HEAD：200，Content-Length 38,695,326。
- 局域网 Range：206，`bytes 0-1023/38695326`，支持断点续传。
- 当前下载地址：
  `http://192.168.68.103:8766/WasteWise-FreshWise-API-v1.4.0-release-test.apk`

首次短路径构建误带入旧 Gradle 自动链接缓存，导致依赖路径横跨 C/D 盘而失败；
删除构建副本中的缓存、从干净源文件重新生成后，上述 release 构建成功。最终
结果以成功的第二次构建为准。

## 清理结果

- D 盘旧 2B 模型目录、2B 验收数据、2B 专用训练/导出脚本、旧离线原生模块、
  旧离线页面和旧 APK/ZIP 已删除。
- 先前暂存于 C 盘的 1,945 个隔离文件已永久删除，约 19.55 GiB。
- 已核对 4B 训练数据、适配器和验收产物仍在 D 盘。
- 最终清理后观测到 D 盘可用约 15.50 GiB，C 盘可用约 50.37 GiB。

## 尚待 4B 服务配置后验收

1. 在 `D:\WasteWise_Grocery_VLM\models\config\external_api.json` 填写密钥
   签发平台提供的 OpenAI-compatible 地址；默认模型已设为
   `qwen3-vl-4b-instruct`。供应端密钥只放服务器 Secret/`.env`。
2. 重启 FastAPI，确认 `/v1/api-recognition/config` 返回 `enabled=true`。
3. 用真实多商品照片和真实小票各做一轮识别，核对名称、数量、坐标和延迟。
4. 使用生产 HTTPS 地址重新构建 APK，并关闭当前仅供局域网原型使用的明文 HTTP。
5. 正式发布前换用生产签名并执行 Android 真机回归。
