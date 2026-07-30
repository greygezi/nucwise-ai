# Desktop AI Assistant

Windows 免安装桌面 AI 助手。在任意应用内选中文字，按 `Ctrl+Alt+Space`，即可总结、回复、代写、润色或检查语法；也可以打开完整对话窗口进行多轮交流。

## 用户启动（免安装）

直接双击发布目录中的 `Desktop AI Assistant-1.0.0-Portable.exe`。程序会启动完整对话窗口，并在后台加载划词浮窗服务；系统托盘只显示一个 Desktop AI Assistant 图标。不写入安装目录、不创建卸载项，也不要求安装 Python、Node.js 或 pnpm。

首次启动为空白工作区，不包含示例对话，也不需要注册或登录任何服务。点击“配置 API”，添加自己的 OpenAI 兼容接口、本地模型或 Dify 配置即可使用。

统一设置保存在 `%APPDATA%\Desktop AI Assistant\`。Dify API Key 使用当前 Windows 账户的系统加密能力保护；旧版浮窗配置仅用于迁移兼容。应用不会读取已安装 Chatbox 的历史会话或登录数据。

## 使用

1. 双击 portable EXE。
2. 在完整对话窗口中点击“配置 API”，配置模型提供商、API 地址、API Key 和模型名称。
3. 在任意 Windows 应用中选中文本，按 `Ctrl+Alt+Space`。
4. 浮窗中按数字键 `1`–`5` 执行对应操作，按 `Esc` 关闭。

完整对话支持 `Ctrl+N` 新建对话、`Ctrl+K` 搜索。从划词助手带入的内容会显示为可关闭的上下文卡片，并保留在草稿中等待用户确认发送。

### 模型提供方管理

- 每个模型提供方标题旁都有删除按钮；删除会清除该提供方的本地 API Key、OAuth 状态和模型配置。
- 内置提供方删除后会从列表隐藏，可通过底部“添加”重新启用。
- 自定义提供方删除后可重新创建或导入。

### 知识库

在“设置 → 知识库”中可以选择两种方式：

1. 本地文件知识库：选择已配置的 Embedding 模型后创建知识库，并添加 PDF、Word、PowerPoint、Excel、Markdown、TXT、CSV、EPUB 等文件。解析、分块和索引保存在本机。
2. Dify 知识工作流：填写 Dify 地址、Workflow API Key、Start 节点查询变量和可选输出变量。启用后，可在对话输入框的知识库按钮中选择该工作流。

本地知识库和 Dify 工作流返回的内容只作为当前问题的参考上下文，最终答案仍由当前选择的对话模型生成。

### Dify 工作流工作台

在“设置 → Dify 工作流”中可以统一管理 Workflow 和 Chatflow：自动读取应用参数、生成动态表单、上传文件、查看流式执行状态和运行历史。可将任一 Workflow 设为浮窗助手工作流；知识库也可引用同一配置，无需重复保存地址和 API Key。

旧版 `~/.dify_workflow_client.json` 可从工作台导入。配置结构会迁移，但为避免在进程间暴露解密后的旧密钥，导入后需要重新填写一次 API Key。

## 源码开发

托盘助手可单独运行：

```powershell
python Floating_window.py
```

完整对话前端位于 `chatbox-ui/`。开发依赖只需要安装在构建机上。

## 生成 portable EXE

构建机需要 Python 3.13、Node.js 22 和 pnpm，然后在项目根目录运行：

```powershell
.\build-windows.ps1
```

脚本会将 Python、PyQt6 和托盘助手封装为侧车 EXE，再嵌入 Electron portable 程序。最终文件位于 `chatbox-ui\release\build\Desktop AI Assistant-1.0.0-Portable.exe`。

## Dify 对接约定

- 托盘划词助手：`POST /v1/workflows/run`，`streaming` 模式，输入 `Input_Text`、`user_request` 和可选的 `how_polish`。
- 对话知识工作流：`POST /v1/workflows/run`，`blocking` 模式，输入变量可在知识库设置中指定。
- 输出：可指定输出变量；留空时读取第一个非空输出。

直接调用 LLM 时使用 OpenAI Chat Completions 兼容接口 `POST /chat/completions`。

## 隐私与许可

- 默认关闭遥测与自动更新，不加载第三方登录或推广脚本。
- 快捷键读取选中文本时会短暂使用系统剪贴板，读取后恢复原文本内容。
- 请勿分发包含个人 API Key 的配置文件。
- 完整对话前端基于 GPL-3.0 开源项目修改，许可证随 portable 程序提供。详细说明见 [CHATBOX_INTEGRATION.md](CHATBOX_INTEGRATION.md)。
