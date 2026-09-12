# FreshWise 手机端 4B API 接入

## 当前架构

Android APK 不再内置 2B/4B 权重。手机只把用户选择的图片发送给
`WasteWise_Grocery_VLM` FastAPI 网关；网关再调用服务端部署的开源 4B
视觉语言模型。当前目标明确为原始 `Qwen3-VL-4B-Instruct` 基座，不加载
WasteWise 自训练 QLoRA 适配器。模型地址、模型名称和供应端密钥全部保留在
服务器上。

这里的“API”可以完全由你自己部署的开源模型提供，不要求购买第三方模型
API。只要 Qwen3-VL-4B 推理服务提供 OpenAI-compatible `/v1/chat/completions`
接口，就能直接接入；无鉴权的本地服务无需设置 `WW_API_KEY`。

```text
Android / Web
  -> WasteWise FastAPI 网关
      -> OpenAI-compatible Qwen3-VL-4B 服务
```

手机端支持：

- 商品照片识别：`POST /v1/api-recognition/analyze`
- 小票食品行识别：`POST /v1/api-recognition/receipt`
- 预计过期日期匹配：`POST /v1/expiry-estimates`

确认表格只显示并允许编辑“商品名称、预计过期日期、数量”。照片模式会在
模型提供可靠 `bounding_box` 时把商品名称框绘制在原图对应位置。小票模式
不伪造商品物理位置。

## 以后配置 4B 模型

在 `D:\WasteWise_Grocery_VLM\models\config\external_api.json` 填写非敏感项：

```json
{
  "api_base_url": "http://127.0.0.1:9000/v1",
  "api_model": "qwen3-vl-4b-instruct",
  "api_prompt_path": "models/config/api_grocery_prompt.txt",
  "api_receipt_prompt_path": "models/config/api_receipt_prompt.txt",
  "api_timeout_seconds": 120.0,
  "api_json_mode": true,
  "api_image_max_edge": 2048,
  "api_max_tokens": 768
}
```

`qwen3-vl-4b-instruct` 是阿里云兼容 API 使用的模型代码。如果你自己的
vLLM/SGLang 服务把同一基座注册为 `Qwen/Qwen3-VL-4B-Instruct`，只修改
`api_model`，不要添加任何适配器路径。

如果模型服务需要密钥，只写入服务端 `D:\WasteWise_Grocery_VLM\.env`：

```dotenv
WW_API_KEY=模型服务密钥
```

不要把 `WW_API_KEY` 写进 Expo 的 `EXPO_PUBLIC_*` 配置。后者会被编译进
APK，不能保存任何真正的秘密。

也不要把密钥先“加密”再随源码提交：客户端或仓库若同时具备解密所需材料，
仍可恢复明文。GitHub 中应使用 Repository/Environment Secret，运行服务器
则使用平台 Secret 或本机未跟踪的 `.env`。已经发到聊天、Issue 或提交中的
密钥应先撤销，再创建新密钥。

## 手机连接网关

本机局域网地址已写入未提交的 `.env`：

```dotenv
EXPO_PUBLIC_GROCERY_AI_API_URL=http://192.168.68.103:8000
```

换网络或部署 HTTPS 后修改它，并用 `npx expo start -c` 清缓存。当前原型为
了局域网 HTTP 测试开启了 Android cleartext traffic；公开部署应使用 HTTPS，
再关闭该选项。

## 启动与检查

```powershell
cd D:\WasteWise_Grocery_VLM
.\.venv\Scripts\python.exe -m uvicorn wastewise_grocery_vlm.main:app --app-dir src --host 0.0.0.0 --port 8000
```

检查 `http://192.168.68.103:8000/v1/api-recognition/config`。在 4B 地址尚未
填写前，返回 `enabled=false` 是真实且预期的状态；不得用假识别结果代替。
