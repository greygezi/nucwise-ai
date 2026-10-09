# NucWise AI 全面使用说明

> 适用版本：NucWise AI `1.1.0`（Windows x64）  
> 发行形态：Windows 10/11 portable 单文件 EXE  
> 文档对象：主对话窗口、模型服务、本地知识库、Dify 工作流、全局划词助手

本说明按当前源码中的界面和配置项整理。不同发行包可能隐藏某些实验功能，服务商的 API 路径、模型名称和计费规则也可能变化；遇到差异时，以软件界面显示和服务商文档为准。

## 1. 软件概览

NucWise AI 是一个本地优先的 Windows 桌面 AI 助手，包含：

- 多模型对话：可配置云端模型、OpenAI 兼容服务和本地模型。
- 全局划词助手：在其他 Windows 应用中选中文字，按 `Ctrl+Alt+Space` 呼出总结、建议答复、代写、润色、语法检查和结构化表达。
- 本地文件知识库：将 PDF、Word、PowerPoint、Excel、Markdown、TXT 等文件解析并建立本地索引。
- Dify 集成：连接 Workflow 或 Chatflow，读取动态输入参数、上传文件并把结果加入当前对话。
- 联网搜索、MCP 和 Skills：按需扩展模型的搜索、工具和任务能力。
- 本地数据管理：设置、会话、附件、知识库索引和日志默认由本机保存。

程序由两个协作部分组成：

| 部分 | 作用 |
| --- | --- |
| Electron/React 主应用 | 对话、模型设置、知识库、Dify 工作台、系统托盘和数据管理 |
| Python 划词助手侧车 | 全局快捷键、读取选中文本、浮窗操作和托盘配置 |

## 2. 安装、启动和退出

### 2.1 普通用户：portable 版本

1. 从可信来源取得 `NucWise AI-1.1.0-Portable.exe`。
2. 将 EXE 放在有写权限的目录；如果需要保存日志或导出文件，避免放在只读的系统目录。
3. 双击启动。portable 版本已包含 Electron、Python 侧车和运行依赖，不需要另装 Python、Node.js 或 pnpm。
4. 首次使用时配置模型服务；没有模型配置时可以打开界面，但不能正常发送模型请求。
5. 退出主窗口后，程序启动的划词助手侧车也会一并退出。

portable 版本不创建传统卸载项。删除 EXE 不会自动删除用户数据；如需清理数据，请先按“备份与恢复”导出，再处理数据目录。

### 2.2 开发者：从源码运行

源码开发需要 Windows 10/11 x64、Python 3.13 x64、Node.js `>=22.12.0 <25.0.0` 和 pnpm 10.x。项目根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
corepack enable
corepack pnpm --dir chatbox-ui install --frozen-lockfile
corepack pnpm --dir chatbox-ui start
```

只改主窗口时，上面的 Electron 命令即可；主窗口开发模式默认不会自动启动 Python 划词助手。要联调划词助手，先生成 `dist\DesktopAssistantTray.exe`，再设置：

```powershell
$env:DESKTOP_ASSISTANT_EXE = (Resolve-Path .\dist\DesktopAssistantTray.exe)
corepack pnpm --dir chatbox-ui start
```

完整构建使用项目根目录的 `build-windows.ps1`，产物通常位于 `chatbox-ui\release\build\`。构建过程和许可证要求见 [README.md](README.md) 与 [CHATBOX_INTEGRATION.md](CHATBOX_INTEGRATION.md)。

## 3. 首次使用：推荐五分钟流程

1. 启动程序，打开“设置 → 模型与服务”。
2. 选择一个已有提供方，填写 API Key；本地服务则填写 API Host/API Address。
3. 在提供方下新增或确认一个模型，点击“Test Model”或“Check”。
4. 打开“设置 → Default Models”，选择默认聊天模型。
5. 返回主窗口，新建会话，确认输入框右下角显示的是目标模型。
6. 发送一句短问题，确认可以正常返回。
7. 划词助手默认跟随主对话当前的 Chat 模型，无需重复配置；如需专用流程，再在“设置 → 划词助手 / Dify”选择一个 Workflow。
8. 需要私有文档问答时，再配置本地 Embedding 模型并建立知识库。

## 4. 主窗口和对话操作

### 4.1 会话区域

- 左侧会话列表用于新建、切换、搜索和管理对话。
- 会话可以单独设置模型、系统提示、上下文消息数量和生成参数；会话设置优先于全局新会话默认值。
- 顶部或会话工具栏可执行新建话题、回退/分支等操作。生成过程中切换会话不会把另一会话的流式文本显示到当前会话。
- 打开“对话设置”可修改当前会话的模型和行为；“设置 → Chat Settings”只改变新会话的默认值。

### 4.2 输入框工具栏

不同版本的图标位置可能略有差异，常用入口包括：

| 入口 | 用途 |
| --- | --- |
| 模型选择器 | 在“模型”和“Dify 工作流”之间切换，并选择具体模型或应用 |
| 附件 | 添加图片、文件或链接；图片是否直接发送取决于模型的 Vision 能力 |
| 知识库 | 选择当前会话要检索的本地知识库或 Dify 知识工作流 |
| Web Search | 让模型先调用所选联网搜索服务；需先在设置中配置 |
| MCP | 使用已启用的 MCP 工具；需先配置服务器并确认模型支持 Tool use |
| 发送/停止 | 发送请求或停止当前生成；网络读阻塞时停止可能要等服务端超时 |

如果输入框提示“尚未选择模型”，请先在右下角选择“模型 / Dify 工作流”，或完成默认模型配置。

### 4.3 附件和长文本

- 小型图片可以直接附加；没有 Vision 能力的模型可通过“Default Models → OCR Model”先识别图片文字，再发送给文本模型。
- 大文件应通过“知识库”上传。若提示需要 Embedding，先配置 Embedding 模型并重试索引。
- “Paste long text as a file”打开后，粘贴的大段文本会转成文件附件，减少输入框和上下文噪声。
- 工作流文件只上传给当前选择的 Dify 应用；不要把保密文件拖入不受信任的第三方服务。

### 4.4 输出和渲染

在“设置 → Chat Settings”可以控制：流式输出、消息左右布局、头像、字数/Token 用量、模型名、时间戳、首字延迟、代码块自动折叠、自动标题、拼写检查、Markdown、LaTeX、Mermaid 和 Artifact 预览。

默认提示词、温度和 Top P 的作用范围是新会话默认值：

- Temperature 范围为 `0–2`；越低越稳定，越高越随机。
- Top P 范围为 `0–1`；通常不需要和 Temperature 同时大幅调整。
- 自动压缩可在上下文使用量达到阈值时总结旧消息。阈值范围 `40%–90%`，默认约 `60%`；较低值省 Token，较高值保留更多上下文。

## 5. 模型与服务配置

### 5.1 已有提供方

“设置 → 模型与服务”可管理内置和自定义服务。当前代码包含 OpenAI、OpenAI Responses、Azure、Claude、Gemini、Qwen、Qwen Portal、MiniMax、Moonshot、Ollama、Groq、DeepSeek、SiliconFlow、VolcEngine、Mistral、LM Studio、Perplexity、xAI、OpenRouter、Amazon Bedrock、Vercel AI Gateway 等提供方；具体列表会随发行版本和模型注册表更新。

根据提供方不同，认证方式可能是 API Key、OAuth、AWS 凭据或本机免密。不要为已有内置服务重复创建自定义服务，直接进入该服务页面编辑即可。

### 5.2 配置内置服务

1. 在模型提供方列表中选择服务。
2. 填写 API Key；Ollama、LM Studio 等本机免密服务可留空。
3. 如服务商要求代理或自定义地址，填写“API Host”；Azure 还需填写 Endpoint 和 API Version；Bedrock 需填写 Access Key、Secret Key 和 Region。
4. 在“Model”区域点击“New”，填写模型 ID；必要时填写昵称。
5. 点击“Test Model”测试基本请求，保存模型。
6. 提供方页面的“Check”会使用已保存的模型检查连接；模型测试还可检查 Vision 和 Tool use。

也可以复制并编辑程序随附的 `ollama-provider.template.json`，把 `apiHost`、`apiKey` 和每个 `modelId` 改为目标电脑的实际值，再在“模型与服务”页面点击“导入配置文件”。导入前会显示地址、隐藏后的密钥和模型清单供确认；导入隐藏或已删除的 Ollama 时会同时恢复该提供方。模板必须至少包含一个非空模型 ID。

### 5.3 新增自定义模型服务

当服务未预置时，点击“新增模型服务”，填写：

| 字段 | 说明 |
| --- | --- |
| 名称 | 在模型选择器中显示的服务名 |
| API Mode | OpenAI API Compatible、OpenAI Responses API Compatible、Claude API Compatible 或 Google Gemini API Compatible |
| API 服务地址 | 服务基础地址；OpenAI 兼容服务通常包含 `/v1`，例如 `http://192.168.1.100:8000/v1` |
| 对话接口路径 | 仅 Chat 模型使用，通常为 `/chat/completions`；Embedding/Rerank 使用各自标准接口 |
| API Key | 本机免密服务可留空；远程服务应填写鉴权信息 |
| 模型名称 | 服务商实际使用的 model ID |
| 模型类型 | Chat、Image、Embedding 或 Rerank |

保存后可进入该服务继续编辑模型。自定义页面显示的“API Address”是组合后的最终地址，避免重复填写路径：不要同时在地址中写一遍 `/chat/completions`，又在接口路径中重复写一次。若某 Embedding 服务提供的是完整 `/v1/embeddings` 地址，应以页面显示的最终地址为准，不要再拼接 Chat 路径。

### 5.4 预置内网模型服务

部署方可以把 `nucwise-provider.defaults.json` 放在以下任一位置，程序启动时自动导入为模型服务：

1. `%APPDATA%\NucWise AI\nucwise-provider.defaults.json`（用户覆盖，升级后仍保留）。
2. 程序 EXE 同目录（便携部署覆盖）。
3. 打包资源目录中的同名文件（随程序发布的默认值）。

项目根目录的 `nucwise-provider.defaults.example.json` 是可复制的模板；将真实 `apiHost`、`apiKey` 和 `modelId` 写入后改名为 `nucwise-provider.defaults.json` 即可，修改文件后重启程序。配置文件只会在提供方尚未填写时写入，用户在“设置 → 模型与服务”中修改后的值默认保留。若升级时需要强制刷新部署值，将 `apply` 改为 `always`；API Key 会随桌面程序配置保存，不能视为不可提取的密钥，生产环境更安全的做法是使用内网网关或短期令牌。

示例文件会随安装包放在 `resources\documentation`，也可以直接使用“设置 → 模型与服务”页面修改已导入的地址、密钥和模型。

### 5.5 模型类型和能力

- `Chat`：普通对话、工具调用和多轮上下文。
- `Image`：图像生成或图像相关调用，实际可用能力取决于提供方。
- `Embedding`：把文本转为向量，是本地知识库建立索引的必选模型。
- `Rerank`：对候选片段二次排序，可选但通常能减少无关上下文。

Chat 模型可以勾选 `Vision`、`Reasoning`、`Tool use`。上下文窗口和最大输出 Token 可在高级设置中填写；不确定时留空，使用提供方默认值。错误勾选 Vision 或 Tool use 可能导致请求格式与服务端能力不匹配，建议先使用“Test Model”自动检测，再保存结果。

### 5.6 默认模型

“设置 → Default Models”分别设置：

- Default Chat Model：新对话默认使用的模型。
- Default Thread Naming Model：自动生成会话标题的模型。
- Search Term Construction Model：联网搜索模式下生成搜索词的模型。
- OCR Model：识别图片文字并转给不支持图片的文本模型；只显示具备 Vision 能力的模型。

留空表示自动沿用最近使用模型或当前聊天模型。需要稳定成本和结果时，建议显式指定默认聊天模型。

## 6. 本地文件知识库

### 6.1 两种知识来源

“设置 → 知识库”同时支持：

1. 完全本地的文件知识库：文件解析、向量索引和检索在本机完成；模型回答时仍会把选中的上下文发送给当前聊天模型。
2. Dify 知识工作流：由 Dify 服务处理查询和知识召回，详见第 7 节。

### 6.2 先配置 Ollama Embedding

桌面版知识库要求至少有一个 Embedding 模型。最快的本地配置流程：

1. 安装并启动 Ollama，在目标电脑预先下载 Embedding 模型，例如 `bge-m3` 或 `nomic-embed-text`。
2. 打开“设置 → 知识库 → 配置本地 Ollama”。
3. 填写 Ollama 服务地址，默认 `http://127.0.0.1:11434`；远程内网服务填写其 IP 和端口。
4. 只有经过鉴权网关时才填写 API Key。
5. 点击“检测连接并读取模型”。程序会读取已有模型，不会替你联网下载。
6. 选择 Embedding 模型；如需要，也可选择默认 Chat 模型并保存。

如果连接成功但没有识别到向量模型，请在 Ollama 中安装 Embedding 模型后重新检测。远程 Ollama 还要确认防火墙、监听地址和网关权限。

### 6.3 全局检索模型和上下文预算

在“知识库”页面选择全局 Embedding、可选 Rerank 和上下文预算：

| 预算 | 适用场景 |
| --- | --- |
| 48,000 字符 | 节省内存和响应时间 |
| 128,000 字符 | 一般推荐值 |
| 256,000 字符 | 本地长上下文模型 |
| 512,000 字符 | 高显存、超长上下文模型 |

预算只限制每次检索注入模型的文本量，不影响本地文件索引完整性。预算越大，响应时间和显存占用可能越高。

没有 Rerank 时，程序使用向量相似度动态筛选，最多返回约 8 个片段；配置 Rerank 后，通常从约 20 个候选中精排出约 5 个片段。实际结果仍取决于分块、模型和问题表述。

### 6.4 创建知识库并添加文件

1. 点击“新建知识库”，填写名称。
2. 确认 Embedding 已选；可在高级选项中更换该库的 Embedding、选择 Rerank 或图片理解模型。
3. 创建后进入该知识库的文件区域，添加 PDF、Word、PowerPoint、Excel、Markdown、TXT、CSV、EPUB 等支持文件。
4. 等待文件解析和索引完成。逐个文件查看状态、重试、预览分块或删除。
5. 在聊天输入框的知识库按钮中选择该库，再提问。未选择知识库时，不会自动检索所有本地文件。

创建后 Embedding 通常会锁定；更换模型需要重建索引。删除知识库会删除对应本地索引和文件记录，执行前确认名称，重要数据先备份原文件。

### 6.5 文档解析器

在“设置 → Document Parser/文档解析”中选择解析方式：

- `Local`：桌面版内置解析，支持常见 PDF 和 Office 文件，不消耗云端计算点。
- `MinerU`：第三方云端解析，适合复杂 PDF/Office；需填写 Token 并点击 Check。
- `Text Only`：只适合移动端/网页端的纯文本文件。
- 旧的 `Chatbox AI` 配置在当前桌面版会按内置 Local 解析处理。

复杂版式、扫描件和图片文字的结果可能依赖解析器与 OCR 模型；索引完成不等于每一页都被准确识别，必要时请预览分块并校对原文。

## 7. Dify 工作流和 Chatflow

### 7.1 在工作台新增应用

打开“设置 → 划词助手 / Dify”，点击“新增”，填写：

| 字段 | 说明 |
| --- | --- |
| 显示名称 | 本地选择器中的应用名 |
| Dify 服务地址 | 例如自建服务的 `/v1` 地址；云端服务按实际部署填写 |
| 应用类型 | `Workflow` 或 `Chatflow` |
| API Key | Dify 应用密钥；编辑已有应用时留空表示保留原密钥 |
| 验证 TLS 证书 | 建议开启；仅可信内网自签名 HTTPS 才考虑关闭 |

点击“测试连接并读取参数”。程序会读取 Dify 参数；如检测到的应用类型与选择不一致，会提示并更新为检测结果。确认无误后点击“保存配置”。“导入旧配置”只导入配置名称和地址，出于安全原因仍需重新填写 API Key。

Workflow 可以设置为“浮窗助手”使用的应用；Chatflow 不显示该按钮，因为划词助手需要一次性 Workflow 调用。

工作台下方保留最近 100 次运行记录，可复制结果或清空历史。清空历史不删除 Dify 服务端数据。

### 7.2 在聊天中运行

1. 在输入框右下角打开“模型 / Dify 工作流”选择器。
2. 切换到“Dify 工作流”标签并选择应用。
3. 程序读取 Workflow/Chatflow 的文字、选项、文件或文件列表参数。
4. 填写动态表单，可把文件拖入对应区域。
5. 点击运行；运行中的任务可停止。
6. 结果会作为普通助手消息加入当前对话。Chatflow 会保留 `conversationId`，后续运行可延续同一上下文。

文件只上传给所选 Dify 应用。若字段没有出现，先在 Dify 控制台确认 Start 节点参数、应用类型和 API Key，再点击“测试连接并读取参数”。

### 7.3 Dify 知识工作流

在“设置 → 知识库”的“Dify 知识工作流”区域：

1. 打开“启用”。
2. 填写显示名称。
3. 从下拉列表选择已在“Dify 工作流”中配置的 Workflow。
4. 填写查询输入变量（默认常见值为 `query`），可选填写结果输出变量。
5. 点击“测试连接”，确认返回文本后保存。
6. 在聊天输入框的知识库按钮中选择该工作流。

如果列表显示“缺少 API Key”，回到 Dify 工作台编辑对应应用并重新保存密钥。结果输出变量留空时，程序会尝试读取第一个文本输出。

## 8. 全局划词助手和系统托盘

### 8.1 使用流程

1. 确认 portable 主程序正在运行，并且托盘中有 NucWise AI 图标。
2. 在邮件、浏览器、Office 或其他 Windows 应用中选中文字。
3. 按 `Ctrl+Alt+Space`（可在托盘设置中改键）。
4. 在浮窗中选择“总结”“建议答复”“代写”“润色”“检查语法”或“结构化表达”。“润色”还包含提升表达清晰度、缩短、增长、简化、以我的语气重写等选项。
5. 结果会流式显示；需要时可停止生成，完成后可“复制结果”“替换原文”或“在完整对话中继续”。

正式版无论使用主对话 Chat 模型还是 Dify Workflow，首次成功回答都会在主窗口后台创建一条对话，浮窗中的连续追问会追加到同一对话；点击“在完整对话中继续”可直接打开它。仅开发时独立运行的 Python 浮窗使用兼容草稿。

“替换原文”会尝试恢复原应用焦点并粘贴结果。浏览器安全策略、远程桌面、权限级别不同或原应用重新复制内容时，替换动作可能失败；此时使用“复制结果”最稳妥。

### 8.2 执行模型与工作流

正式版在“设置 → 划词助手 / Dify”选择划词助手的执行方式：

- “主对话 Chat 模型”直接复用主程序的统一配置：若设置了默认模型则使用它，否则跟随主对话最近使用的 Chat 模型，不再要求为划词助手重复配置。
- 选择某个 Workflow 时调用 Dify `/workflows/run`；Dify 配置只影响划词助手，不改变主窗口默认 Chat 模型。
- 未显式选择 Workflow 时默认使用 Chat 模型；浮窗操作栏会显示当前实际执行引擎。
- 只有主对话从未选择过任何 Chat 模型时，浮窗才会提示先在主对话的模型选择器中选择。

仅在开发时单独运行 `Floating_window.py`，才使用 Python 侧独立配置；该模式可配置 Dify Workflow 或 OpenAI 兼容 `/chat/completions`。正式版无需重复填写模型 API Key。

### 8.3 快捷键冲突

如果托盘提示快捷键已被占用：

1. 关闭占用该组合键的录屏、输入法或其他工具。
2. 在托盘“设置”中录制新的组合键。
3. 保存后重新测试；必要时重启主程序。

## 9. 联网搜索、MCP 和 Skills

### 9.1 Web Search

“设置 → Web Search”可选择：

- Chatbox AI：集成搜索服务，通常需要相应账号或许可。
- Bing Search (Free)：免费入口，但受服务方限制。
- Tavily、BoCha、Querit：填写各自 API Key 并点击 Check。

Querit 还可设置最多返回 `1–10` 条结果和时间范围（天、周、月、年）。搜索服务的请求和网页内容会离开本机，涉密问题不要开启联网搜索。

### 9.2 MCP

在 MCP 设置中启用内置服务器或新增自定义服务器。传输类型包括：

- `stdio`：填写本地命令、参数和环境变量。
- `http`：填写服务器 URL 和可选请求头。

只启用可信服务器，尤其不要把包含密钥的环境变量交给不明脚本。聊天中只有在 MCP 按钮启用、模型勾选 Tool use 且服务器在线时，工具调用才会生效。

### 9.3 Skills

已启用的 Skills 会在 Task 模式中提供。第三方技能可能执行文件、网络或外部命令；安装前查看来源和所需权限，完成任务后可关闭不再使用的技能。

## 10. 常规设置

“设置 → General Settings”包含：

- 显示：语言、跟随系统/浅色/深色主题、字体大小（约 `10–22`）、启动页（主页或上次会话）。
- 网络：HTTP/SOCKS 代理，例如 `socks5://127.0.0.1:6153`。
- 数据恢复：会话列表丢失时扫描本地存储并恢复。
- 数据备份：按需选择 Settings、API KEY & License、Chat History、My Copilots 后导出 JSON。
- 数据恢复导入：导入后会立即重启并覆盖同名数据；必须先备份当前数据。
- 诊断日志：导出排障日志。发送前检查是否包含地址、文件名或其他敏感信息。
- 错误报告：可选的匿名崩溃和事件上报。
- Windows：开机自启动、自动更新和 Beta 更新。

“设置 → Chat Settings”还可以修改头像（PNG/JPG，小于 5 MB）、默认提示词、背景图片、流式输出、消息显示和自动上下文压缩。

## 11. 数据位置、备份和安全

常见本地位置如下；实际路径以当前用户和发行方式为准：

| 数据 | 常见位置 |
| --- | --- |
| Electron 主应用数据 | `%APPDATA%\NucWise AI\` |
| 打包后的划词助手配置 | `%APPDATA%\DesktopAIAssistant\config.json` |
| 直接运行 `Floating_window.py` 的配置 | 项目根目录 `config.json` |

主应用数据可能包含设置、会话、附件、知识库索引和日志。不要在程序运行时手工编辑数据库或配置文件；先关闭程序并复制备份。

备份建议：

1. 在“General Settings → Data Backup”至少导出 Settings 和 Chat History。
2. 是否包含 API KEY & License 由安全要求决定；包含密钥的导出文件应加密保存，不要发送到群聊或代码仓库。
3. 知识库索引不是原始文件备份；原始 PDF/Office 文件仍应单独备份。
4. 恢复前先导出当前数据，确认导入 JSON 来自可信来源。

隐私边界：本地知识库的解析和索引不会因为建库自动上传，但回答时选中的上下文会随模型请求发送到所选模型提供方；开启 Dify、Web Search、MCP 或 MinerU 时还会发送到对应服务。API Key 不要写入源码、截图、日志或示例文件。

## 12. 常见问题排查

### 12.1 “连接失败”或 HTTP 404

1. 确认 API Host/API Address 的协议、域名、端口正确。
2. OpenAI 兼容服务通常使用基础地址加 `/v1`，接口路径为 `/chat/completions`。
3. 不要把 `/chat/completions` 在 Host 和 Path 中各写一次；以页面显示的最终地址为准。
4. 检查 API Key、模型 ID、代理和服务端日志。
5. 先用“Test Model”测试一个最简单的 Chat 模型，再逐步测试 Vision/Tool use。

### 12.2 模型列表为空

- 确认模型已保存且模型类型正确。
- 本地 Ollama 点击“检测连接并读取模型”；只会读取已安装模型。
- 某些服务不提供模型列表接口时，手动点击“New”填写模型 ID。
- 确认自定义服务的 API Mode 与实际协议一致。

### 12.3 Dify 返回 401、404 或参数为空

- 401 通常表示 API Key 错误或应用密钥不匹配。
- 404 通常表示服务地址缺少正确的 `/v1` 或指向了 Web 页面而非 API 根地址。
- 点击“测试连接并读取参数”，检查 Workflow/Chatflow 类型和 Start 节点变量。
- 自签名内网 HTTPS 可在确认网络可信后关闭 TLS 校验；公网服务不要关闭。

### 12.4 本地知识库无法创建或没有召回

- 先配置 Embedding；仅有 Chat 模型不能建立向量索引。
- 等待文件状态变为完成；失败文件单独重试并查看预览分块。
- 确认当前对话选中了目标知识库。
- 先使用 48,000 或 128,000 字符预算测试，再按模型上下文逐步增加。
- 更换 Embedding 后需要重建索引，不能直接期待旧索引兼容。

### 12.5 Ollama 连接被拒绝

确认 Ollama 进程已启动、地址没有写错、端口可访问。默认地址是 `http://127.0.0.1:11434`；远程部署还需检查监听地址、防火墙和网关鉴权。NucWise AI 不会替 Ollama 下载模型。

### 12.6 划词助手没有反应

- 确认主程序和托盘侧车仍在运行。
- 检查快捷键是否被其他程序占用。
- 使用 Chat 时确认主对话已选择可用模型；使用 Workflow 时确认“设置 → 划词助手 / Dify”中的地址和 API Key 有效。
- 先在记事本中测试选中一小段文字；如果记事本可用而目标软件不可用，通常是目标软件权限或剪贴板策略限制。

### 12.7 会话列表丢失

先不要删除用户数据目录，打开“General Settings → Data Recovery → Recover Conversation List”。恢复前后都保留备份；恢复工具只扫描现有本地存储，无法恢复已经被手工删除的文件。

### 12.8 Windows 显示“未知发布者”

当前 portable 构建未必带代码签名。只有在确认 EXE 来自可信发布源、文件校验值符合预期时才继续运行。

## 13. 开发与维护附录

常用检查命令：

```powershell
python -m py_compile Floating_window.py
corepack pnpm --dir chatbox-ui run check
corepack pnpm --dir chatbox-ui test
corepack pnpm --dir chatbox-ui run lint
corepack pnpm --dir chatbox-ui run build
```

请保留 `config.json`、用户数据库、API Key 和现有发行 EXE，不要用实验构建覆盖已验收文件。修改涉及外部模型、真实 Dify、跨应用划词、Windows 重启自启动或打包后 UI 时，应在目标环境做一次真实验收。

## 14. 本说明的验证边界

本说明已按当前源码、README、Dify 工作台、知识库和划词助手实现整理；源码类型检查、前端构建和现有回归记录已通过。真实第三方模型、真实 Dify 服务、所有 Office/PDF 文件类型、每种 Windows 应用的剪贴板焦点行为、重启后的自启动和最终发行包的完整 UI 仍受本机环境与服务端影响，应按第 3 节流程在目标环境验证。
