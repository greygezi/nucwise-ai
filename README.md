# NucWise AI

NucWise AI 是一款面向 Windows 的本地优先桌面 AI 助手，集成完整对话窗口、全局划词浮窗、多模型提供方、本地知识库和 Dify 工作流。

在任意应用中选中文字后按 `Ctrl+Alt+Space`，可以快速总结、建议答复、代写、润色、检查语法或结构化表达；也可以在主窗口中进行多轮对话、管理模型和知识库。

> 当前版本：`1.1.0`
>
> 官方构建目标：Windows 10/11 x64 portable EXE
>
> 开源许可：GPL-3.0-only

## 主要功能

- 完整的 Electron 桌面对话客户端。
- Windows 全局快捷键和划词浮窗。
- OpenAI 兼容接口、云端模型和本地模型支持。
- PDF、Word、PowerPoint、Excel、Markdown、TXT、CSV、EPUB 等本地知识库。
- Dify Workflow 和 Chatflow 动态表单、文件上传及运行历史。
- 对话搜索、会话管理、Markdown、LaTeX 和代码高亮。
- 本地保存配置、会话、附件和知识库索引。
- Windows portable 单文件发行，不创建卸载项。

## 技术架构

项目由两个协作进程组成：

| 组件 | 位置 | 技术 | 作用 |
| --- | --- | --- | --- |
| 主桌面应用 | `chatbox-ui/` | Electron、React、TypeScript | 对话界面、模型管理、知识库、Dify 工作流和系统托盘 |
| 划词助手 | `Floating_window.py` | Python、PyQt6 | 全局快捷键、选中文本读取和快捷操作浮窗 |

正式打包时，`Floating_window.py` 会通过 PyInstaller 生成为 `DesktopAssistantTray.exe`，再作为侧车程序嵌入 Electron portable EXE。Electron 使用仅监听 `127.0.0.1` 的随机端口和随机令牌管理侧车生命周期。

## 普通用户运行

获得发行文件后，直接双击：

```text
NucWise AI-1.1.0-Portable.exe
```

portable 版本已经包含 Electron、Python、PyQt6 和运行所需的 Node.js 依赖。普通用户不需要安装 Python、Node.js 或 pnpm。

首次启动后，可以在应用内配置自己的模型提供方、API 地址、API Key 和模型名称。部署方也可以预置同目录或用户目录的 `nucwise-provider.defaults.json`，让内网模型打开即用；详情见《NucWise AI 使用说明》的“预置内网模型服务”。随后可以：

1. 在主窗口中直接创建对话。
2. 在任意 Windows 应用中选中文字。
3. 按 `Ctrl+Alt+Space` 打开划词浮窗。
4. 选择总结、建议答复、代写、润色、语法检查或结构化表达。

## 从源码开始开发

### 1. 环境要求

完整构建和划词助手目前以 Windows x64 为目标。

| 工具 | 要求 |
| --- | --- |
| Windows | Windows 10 或 Windows 11，x64 |
| Git | 建议使用当前稳定版 |
| PowerShell | Windows PowerShell 5.1 或 PowerShell 7 |
| Python | Python 3.13 x64 |
| Node.js | `>=22.12.0 <25.0.0` |
| pnpm | 由 Corepack 根据项目锁定版本提供，当前为 10.x |

安装过程中需要联网下载 Python、Node.js、Electron 和打包依赖。建议至少预留 5 GB 可用磁盘空间。

### 2. Fork 并克隆

准备进行二次开发时，建议先在 GitHub 上 Fork 本仓库，再克隆自己的 Fork：

```powershell
git clone https://github.com/<你的GitHub用户名>/nucwise-ai.git
cd nucwise-ai
git remote add upstream https://github.com/greygezi/nucwise-ai.git
```

如果只需要获取源码，也可以直接克隆主仓库：

```powershell
git clone https://github.com/greygezi/nucwise-ai.git
cd nucwise-ai
```

### 3. 创建 Python 虚拟环境

建议把 Python 依赖安装到项目虚拟环境，避免修改全局 Python：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

如果 PowerShell 阻止激活脚本，可以只对当前终端临时放行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

### 4. 安装 Electron 依赖

项目使用 pnpm workspace，不要改用 npm 或 yarn 安装根前端依赖：

```powershell
corepack enable
corepack pnpm --dir chatbox-ui install --frozen-lockfile
```

`node_modules` 只存在于本地开发环境，已被 Git 忽略，不需要提交到 GitHub。其他开发者运行安装命令后会自行重建。

## 开发模式

可以根据修改范围选择以下三种模式。

### 模式 A：只开发 Electron 主应用

适合修改对话界面、模型提供方、知识库、Dify 工作流或 Electron 主进程：

```powershell
corepack pnpm --dir chatbox-ui start
```

该模式支持前端热更新，但默认不会自动启动 Python 划词助手。

主要源码目录：

- `chatbox-ui/src/main/`：Electron 主进程。
- `chatbox-ui/src/preload/`：安全的 preload 和 IPC 接口。
- `chatbox-ui/src/renderer/`：React 用户界面。
- `chatbox-ui/src/shared/`：主进程和渲染进程共享代码。

### 模式 B：只开发 Python 划词助手

适合修改全局快捷键、选中文本读取、Dify 快捷动作和浮窗界面：

```powershell
python Floating_window.py
```

首次运行可以直接使用默认空配置，也可以复制示例配置：

```powershell
Copy-Item config.example.json config.json
```

然后在本地 `config.json` 中填写自己的接口信息。`config.json` 已被 Git 忽略，禁止将真实 API Key 提交到仓库。

### 模式 C：Electron 与 Python 联调

Electron 开发模式只会在设置了 `DESKTOP_ASSISTANT_EXE` 时自动启动侧车。先生成开发用侧车：

```powershell
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --noconsole `
  --name DesktopAssistantTray `
  --distpath dist `
  --workpath build\pyinstaller `
  --specpath build `
  --icon chatbox-ui\assets\nucwise-nid-icon-imagen-v1-transparent.ico `
  --add-data "chatbox-ui\assets\nucwise-nid-icon-imagen-v1-transparent.ico;." `
  Floating_window.py
```

在同一个 PowerShell 窗口中设置侧车路径并启动 Electron：

```powershell
$env:DESKTOP_ASSISTANT_EXE = (Resolve-Path .\dist\DesktopAssistantTray.exe)
corepack pnpm --dir chatbox-ui start
```

此时 Electron 会使用 hosted 模式启动侧车，并在主程序退出时关闭它。修改 `Floating_window.py` 后，需要重新生成侧车 EXE。

## 构建 Windows portable EXE

确保 Python 虚拟环境已经激活，然后在项目根目录运行：

```powershell
.\build-windows.ps1
```

构建脚本会依次：

1. 安装 `requirements.txt` 中的 Python 依赖。
2. 根据 `pnpm-lock.yaml` 安装 Electron 项目依赖。
3. 使用 PyInstaller 生成 `dist\DesktopAssistantTray.exe`。
4. 运行 TypeScript 类型检查。
5. 构建 Electron 主进程、preload 和 renderer。
6. 安装最终应用真正需要的生产依赖。
7. 使用 electron-builder 生成 Windows x64 portable EXE。

成功后的主要产物：

```text
chatbox-ui\release\build\NucWise AI-1.1.0-Portable.exe
```

打包配置位于 `chatbox-ui/electron-builder.yml`。最终 EXE 只包含编译结果、Electron 运行时、Python 侧车和生产依赖，不会把完整的开发用 `node_modules` 原样装入发行文件。

## 常用检查命令

提交代码前至少运行与修改范围相关的检查。

Python 语法检查：

```powershell
python -m py_compile Floating_window.py
```

TypeScript 类型检查：

```powershell
corepack pnpm --dir chatbox-ui run check
```

前端测试：

```powershell
corepack pnpm --dir chatbox-ui test
```

代码规范检查：

```powershell
corepack pnpm --dir chatbox-ui run lint
```

生产构建但不生成安装包：

```powershell
corepack pnpm --dir chatbox-ui run build
```

## 项目结构

```text
nucwise-ai/
├── Floating_window.py          # Python 划词助手
├── config.example.json        # Python 侧示例配置
├── requirements.txt           # Python 依赖
├── build-windows.ps1          # Windows 完整构建脚本
├── CHATBOX_INTEGRATION.md      # 上游前端和侧车集成说明
├── CONTRIBUTING.md             # 贡献流程
├── LICENSE                     # GPL-3.0-only 许可说明
└── chatbox-ui/
    ├── src/
    │   ├── main/               # Electron 主进程
    │   ├── preload/            # preload 与 IPC
    │   ├── renderer/           # React 界面
    │   └── shared/             # 共享类型和工具
    ├── release/app/            # electron-builder 应用入口
    ├── electron-builder.yml    # 打包配置
    ├── package.json            # Node.js 脚本和依赖
    ├── pnpm-lock.yaml          # 锁定依赖版本
    └── .npmrc                  # pnpm workspace 配置
```

以下目录属于本地生成内容，不应提交：

- `.venv/`
- `node_modules/`
- `build/`
- `dist/`
- `chatbox-ui/release/build/`
- `config.json`

## 配置和本地数据

不同运行方式使用不同的本地路径：

- 源码直接运行 `Floating_window.py`：根目录的 `config.json`。
- 打包后的 Python 侧车：`%APPDATA%\DesktopAIAssistant\config.json`。
- Electron 主应用：由 Electron `app.getPath('userData')` 管理，Windows 上通常位于 `%APPDATA%\NucWise AI\`。

Electron 主应用的数据包括设置、会话、附件、本地知识库索引和运行日志。删除或迁移这些目录前应先备份。

### API Key 安全

- 不要提交 `config.json`、`.env`、日志、聊天导出或包含真实密钥的截图。
- 不要把 API Key 写入源码、测试文件或示例命令。
- 提交前使用 `git status` 和 `git diff --cached` 检查将要上传的内容。
- 如果密钥已经进入 Git 历史，应立即在服务商处撤销，而不仅是删除文件。

## Dify 对接

正式版划词助手可以直接跟随主对话的统一 Chat 模型，也可以切换到指定的 Dify Workflow：

- 主对话 Chat 模型：优先使用已设置的默认模型，否则沿用主对话最近使用的模型和现有提供方配置，无需为划词助手重复配置。
- Chat 或 Dify 的划词结果和浮窗追问都会保存到同一个主窗口会话，“在完整对话中继续”会直接打开该会话。
- Dify 划词助手：调用 `POST /v1/workflows/run`；在“设置 → 划词助手 / Dify”中选择主对话 Chat 模型或指定 Workflow。
- 知识工作流：调用 `POST /v1/workflows/run`，使用 blocking 模式。
- 工作流工作台：管理 Workflow 和 Chatflow、动态输入参数、文件上传及运行历史。

单独运行 `Floating_window.py` 时仍可直接调用 OpenAI 兼容 Chat Completions 接口。具体的桥接和深链约定见 [CHATBOX_INTEGRATION.md](CHATBOX_INTEGRATION.md)。

## 二次开发与提交贡献

推荐使用以下流程：

```powershell
git checkout main
git pull --ff-only upstream main
git checkout -b feature/你的功能名称
```

完成修改和本地检查后：

```powershell
git status
git diff
git add <需要提交的文件>
git commit -m "描述本次修改"
git push -u origin feature/你的功能名称
```

然后在 GitHub 上向 `greygezi/nucwise-ai` 的 `main` 分支发起 Pull Request，并说明：

- 修改目的和实现方式。
- 对用户或开发者的影响。
- 已运行的测试和检查。
- 界面修改前后的截图（如适用）。

请尽量保持单个 Pull Request 聚焦于一个问题。更详细的约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 常见问题

### `pnpm` 命令不存在

确认已安装符合版本要求的 Node.js，然后执行：

```powershell
corepack enable
corepack pnpm --version
```

### PowerShell 无法激活 `.venv`

只对当前终端临时放行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Electron 开发模式没有划词浮窗

这是预期行为。请按照“模式 C”生成侧车，并在启动 Electron 前设置 `DESKTOP_ASSISTANT_EXE`。

### 构建时找不到 `DesktopAssistantTray.exe`

确认虚拟环境中的 PyInstaller 安装成功，并检查：

```powershell
Test-Path .\dist\DesktopAssistantTray.exe
```

### Windows 提示未知发布者

当前 portable 构建没有代码签名证书，Windows 可能显示正常的未签名应用警告。只有在确认 EXE 来源可信时才应继续运行。

## 隐私

- 默认关闭遥测和自动更新。
- API Key、聊天数据和知识库索引保存在本机。
- 划词快捷键会短暂使用系统剪贴板读取选中文本，并在读取后恢复原内容。
- 本地知识库文件不会因为建立索引而自动上传；模型请求仍会按照所选模型提供商的接口配置发送必要上下文。

## 许可和上游项目

`chatbox-ui/` 基于 [Chatbox Community Edition](https://github.com/chatboxai/chatbox) 修改，采用 GPL-3.0。

本项目整体以 `GPL-3.0-only` 发布。分发本项目或其衍生版本时，应保留版权及许可证声明，并按照 GPL-3.0 向接收者提供相应源码和修改内容。完整许可证文本位于 `chatbox-ui/LICENSE`，集成说明见 [CHATBOX_INTEGRATION.md](CHATBOX_INTEGRATION.md)。
