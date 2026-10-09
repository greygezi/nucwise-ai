# 上游前端与 GPL 集成说明

本项目的 `chatbox-ui/` 为 [Chatbox Community Edition](https://github.com/chatboxai/chatbox) 的源码副本，用作桌面对话前端；导入日期为 2026-07-19。

## 运行与打包

普通用户只需双击 `Desktop AI Assistant-1.0.0-Portable.exe`，不需要安装 Chatbox、Python 或 Node.js。portable 主程序会启动统一对话窗口和无托盘的内置划词浮窗服务，系统托盘始终只有一个应用入口。

开发构建时，在项目根目录运行：

```powershell
.\build-windows.ps1
```

构建脚本会：

- 使用 PyInstaller 将 `Floating_window.py` 及 Python/PyQt6 运行时封装为无托盘侧车 `DesktopAssistantTray.exe`；Electron 通过带随机令牌的本机控制通道管理其生命周期和浮窗动作；
- 构建 Electron 主程序；
- 把托盘 EXE、文档和 GPLv3 许可证写入应用资源；
- 生成 x64 portable 单 EXE 到 `chatbox-ui\release\build\`。

开发模式仍可分别启动 Electron 前端和 `Floating_window.py`；正式发布版会自动管理两个进程。主程序退出时会终止由它启动的托盘侧车。

## 划词桥接

独立运行 Python 助手时会打开以下深链：

```text
desktopassistant://assistant/compose?text=<URL 编码的文本>
```

本项目在以下位置增加了桥接代码：

- `src/main/deeplinks.ts`：识别独立模式深链并发送 Electron IPC 事件。
- `src/main/main.ts`：在正式版中通过带请求编号的本机控制通道分派 Chat/Dify 动作、流式片段、取消和继续对话。
- `src/preload/index.ts`、`src/shared/electron-types.ts`：暴露受限的双向 IPC 接口。
- `src/renderer/desktopAssistant.ts`、`src/renderer/routes/__root.tsx`：按“默认模型优先、否则最近使用模型”复用主对话 Chat 配置，把划词动作、原文、回答和后续追问写入同一个主窗口会话。
- `src/renderer/components/InputBox/InputBox.tsx`：消费草稿、写入当前输入框并聚焦。

正式版使用主对话 Chat 模型或 Dify Workflow 时，首次成功回答都会在后台创建主窗口会话，浮窗追问会继续追加到该会话；“在完整对话中继续”直接打开它。独立 Python 模式仍使用草稿兼容路径。

## 许可与发布

Chatbox Community Edition 使用 GPL-3.0，完整许可证位于 `chatbox-ui/LICENSE`。若发布、分发或打包包含此修改版前端的应用，须遵守 GPL-3.0，包括保留版权及许可证声明，并向接收者提供相应完整源码与修改内容。根目录的 Python 托盘助手通过深链与该前端协作。
