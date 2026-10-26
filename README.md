# Tavern Next

一个 Windows 优先的 SillyTavern 独立桌面前端原型，内置可操作应用界面的 AI 助手。

## 启动

需要 Node.js、pnpm，以及 Tauri 2 所需的 Windows C++ Build Tools 和 WebView2。

```powershell
pnpm install
pnpm tauri dev
```

只预览前端也可以运行 `pnpm dev`。

## 当前功能

- 导入 SillyTavern PNG（读取 `chara` / `ccv3` 元数据）和 JSON 角色卡。
- 导入 SillyTavern JSON 聊天记录，并按角色管理多段本地会话。
- 使用 OpenAI 兼容的 Chat Completions 接口流式生成角色回复；可连接 Ollama、LM Studio 或兼容云服务。
- 本地 IndexedDB 保存角色、对话和模型设置；可导出本地 JSON 备份。
- 内置助手可读取当前应用上下文、搜索角色、查看最近对话、切换页面、打开设置和创建角色卡；支持截图提问，并在界面展示工具调用记录。
- API 密钥只保留在当前运行内存，不写入本地数据和备份文件。

## 当前范围

这是首个可运行版本，暂不包含 SillyTavern 的扩展生态、世界书/正则脚本、群聊、预设迁移和完整聊天格式兼容。助手的工具调用需要模型服务支持 OpenAI 风格的 `tools` / function calling；截图问答需要模型支持图像输入。
