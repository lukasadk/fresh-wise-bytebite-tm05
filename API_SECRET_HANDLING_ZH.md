# 4B API 密钥安全约定

## 不进入 GitHub 或 APK

模型供应端密钥只允许由 WasteWise FastAPI 进程从服务器环境变量
`WW_API_KEY` 读取。以下位置禁止保存真实值：

- React Native / Expo 源码；
- 任意 `EXPO_PUBLIC_*` 变量；
- `app.json`、`eas.json` 或 Android resources；
- Git 已跟踪的配置、文档、测试夹具或构建产物。

把密钥加密后连同客户端解密材料一起提交并不安全，APK 可以被反编译。App
只调用网关，网关才使用模型密钥。

## 本地服务器

真实值放在被 `.gitignore` 排除的
`D:\WasteWise_Grocery_VLM\.env`：

```dotenv
WW_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
WW_API_MODEL=qwen3-vl-flash
WW_API_RECIPE_MODEL=qwen-plus
WW_API_KEY_REQUIRED=true
WW_API_KEY=在签发平台重新生成的密钥
```

不要根据 Key 外观猜测平台或把 Key 发送给未经确认的域名。

## GitHub 与部署平台

只有自动部署确实需要时，才在 GitHub 仓库的 **Settings → Secrets and
variables → Actions** 创建名为 `WW_API_KEY` 的 Repository Secret。GitHub
会加密保存 Secret，工作流日志也不得主动打印它。Railway、Render 或云主机
部署时，优先直接在对应平台的 Secret/Variables 页面设置同名变量，仓库中
继续只保留空占位符。

任何已经出现在聊天、Issue、日志或 Git 历史中的密钥，都按已泄漏处理：先在
签发平台撤销，再生成新密钥，然后只放入上述 Secret 存储。
