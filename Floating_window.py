"""Windows 划词 AI 助手：快捷键唤起浮窗并调用 Dify Workflow。"""

import html
import copy
import ctypes
import ipaddress
import json
import os
import re
import socket
import sys
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import urlparse
from urllib.parse import quote

import keyboard
import pyperclip
import requests
from PyQt6.QtCore import QAbstractNativeEventFilter, QEvent, QObject, QPoint, Qt, QThread, pyqtSignal
from PyQt6.QtGui import QCursor, QIcon, QKeySequence
from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGridLayout,
    QHBoxLayout,
    QCheckBox,
    QComboBox,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMessageBox,
    QKeySequenceEdit,
    QPushButton,
    QStyle,
    QSystemTrayIcon,
    QTextBrowser,
    QTextEdit,
    QToolButton,
    QVBoxLayout,
    QWidget,
    QSplitter,
)

BASE_DIR = Path(__file__).resolve().parent


def resource_path(filename):
    """Resolve bundled resources in both source and PyInstaller builds."""
    base_dir = Path(getattr(sys, "_MEIPASS", BASE_DIR))
    return base_dir / filename


def config_path():
    """Use a writable per-user location in the packaged application."""
    if getattr(sys, "frozen", False):
        app_data = Path(os.environ.get("APPDATA", Path.home())) / "DesktopAIAssistant"
        app_data.mkdir(parents=True, exist_ok=True)
        return app_data / "config.json"
    return BASE_DIR / "config.json"


CONFIG_PATH = config_path()
DEFAULT_CONFIG = {
    "dify_base_url": "https://api.dify.ai/v1",
    "dify_api_key": "",
    "user": "desktop-assistant",
    "hotkey": "ctrl+alt+space",
    "profiles": [],
    "active_profile_id": "",
    "chat_sessions": [],
    "actions": [
        {"id": "summarize", "label": "总结", "user_request": "总结"},
        {"id": "reply", "label": "回复", "user_request": "回复"},
        {"id": "draft", "label": "代写", "user_request": "代写"},
        {"id": "polish", "label": "润色", "submenu": "polish"},
        {"id": "grammar", "label": "检查语法", "user_request": "检查语法"},
    ],
    "polish_options": [
        {"label": "提升表达清晰度", "how_polish": "提升表达的清晰度"},
        {"label": "缩短", "how_polish": "缩短"},
        {"label": "增长", "how_polish": "增长"},
        {"label": "简化", "how_polish": "简化"},
        {"label": "以我的语气重写", "how_polish": "以我的语气重写"},
    ],
}

WM_HOTKEY = 0x0312
HOTKEY_ID = 0xD1F1
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN = 0x0001, 0x0002, 0x0004, 0x0008


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p), ("message", ctypes.c_uint),
        ("wParam", ctypes.c_size_t), ("lParam", ctypes.c_ssize_t),
        ("time", ctypes.c_uint), ("pt_x", ctypes.c_long), ("pt_y", ctypes.c_long),
    ]


def parse_hotkey(hotkey):
    """把设置中的 ctrl+alt+space 转为 Windows RegisterHotKey 参数。"""
    parts = {part.strip().lower() for part in hotkey.split("+") if part.strip()}
    modifiers = 0
    for name, value in (("alt", MOD_ALT), ("ctrl", MOD_CONTROL), ("control", MOD_CONTROL), ("shift", MOD_SHIFT), ("win", MOD_WIN), ("meta", MOD_WIN)):
        if name in parts:
            modifiers |= value
            parts.remove(name)
    if len(parts) != 1:
        raise ValueError("快捷键格式应类似 ctrl+alt+space。")
    key = parts.pop()
    named_keys = {
        "space": 0x20, "tab": 0x09, "enter": 0x0D, "return": 0x0D, "esc": 0x1B,
        "backspace": 0x08, "delete": 0x2E, "insert": 0x2D, "home": 0x24, "end": 0x23,
        "pgup": 0x21, "pageup": 0x21, "pgdown": 0x22, "pagedown": 0x22,
        "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    }
    if key in named_keys:
        return modifiers, named_keys[key]
    if len(key) == 1 and key.isalnum():
        return modifiers, ord(key.upper())
    if key.startswith("f") and key[1:].isdigit() and 1 <= int(key[1:]) <= 24:
        return modifiers, 0x70 + int(key[1:]) - 1
    raise ValueError("目前支持字母、数字、常用编辑/方向键和 F1–F24。")


def api_base(value):
    """兼容 Dify API 地址、实例地址和发布链接，统一转换为 Service API 地址。"""
    value = value.strip().rstrip("/")
    if not value:
        raise ValueError("请填写 Dify 服务地址或发布链接。")
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    parsed = urlparse(value)
    if not parsed.netloc:
        raise ValueError("Dify 服务地址格式不正确。")
    host = parsed.netloc.lower().split(":")[0]
    if host.endswith("udify.app") or host in {"dify.ai", "cloud.dify.ai", "api.dify.ai"}:
        return "https://api.dify.ai/v1"
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}" if path.endswith("/v1") else f"{parsed.scheme}://{parsed.netloc}/v1"


def is_local_dify_address(value):
    """本机/私网 Dify 常使用自签名证书。"""
    try:
        parsed = urlparse(value if re.match(r"^https?://", value, re.I) else "https://" + value)
        host = (parsed.hostname or "").lower()
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local") or "." not in host:
            return True
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def normalize_profiles(config):
    """兼容早期单工作流配置，并迁移为可切换的配置档。"""
    profiles = config.get("profiles") or []
    if not profiles:
        base_url = config.get("dify_base_url", DEFAULT_CONFIG["dify_base_url"])
        profiles = [{
            "id": str(uuid.uuid4()), "name": "默认工作流", "base_url": base_url,
            "api_key": config.get("dify_api_key", ""), "verify_tls": not is_local_dify_address(base_url),
            "mode": "workflow", "model": "",
        }]
    normalized = []
    for index, profile in enumerate(profiles):
        base_url = profile.get("base_url", profile.get("dify_base_url", DEFAULT_CONFIG["dify_base_url"]))
        normalized.append({
            "id": profile.get("id") or str(uuid.uuid4()),
            "name": profile.get("name") or f"工作流 {index + 1}",
            "base_url": base_url,
            "api_key": profile.get("api_key", profile.get("dify_api_key", "")),
            "verify_tls": profile.get("verify_tls", not is_local_dify_address(base_url)),
            "mode": profile.get("mode", "workflow"),
            "model": profile.get("model", ""),
        })
    config["profiles"] = normalized
    if config.get("active_profile_id") not in {profile["id"] for profile in normalized}:
        config["active_profile_id"] = normalized[0]["id"]
    if not isinstance(config.get("chat_sessions"), list):
        config["chat_sessions"] = []
    return config


def active_profile(config):
    normalize_profiles(config)
    return next(profile for profile in config["profiles"] if profile["id"] == config["active_profile_id"])


def first_output(outputs):
    for value in (outputs or {}).values():
        if value is not None and str(value).strip():
            return str(value)
    return ""


def direct_llm_messages(text, action):
    """把浮窗操作转换为可用于 OpenAI 兼容接口的提示词。"""
    request = action.get("user_request", action.get("label", ""))
    prompts = {
        "总结": "请总结以下邮件内容，提炼背景、关键事项、待办和时间要求。",
        "回复": "请根据以下邮件，起草一封专业、自然的回复邮件。",
        "代写": "请将以下内容整理并代写成一封清晰、专业的电子邮件。",
        "检查语法": "请检查以下邮件的语法和表达问题，并给出修正后的完整邮件。",
    }
    if request == "润色":
        how = action.get("how_polish", "提升表达的清晰度")
        system = f"请润色以下邮件，要求：{how}。保持原意，直接输出润色后的邮件。"
    else:
        system = prompts.get(request, f"请根据要求“{request}”处理以下邮件内容。")
    return [{"role": "system", "content": system}, {"role": "user", "content": text}]


def chat_completions_url(value):
    base = value.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{api_base(base)}/chat/completions"


class GlobalHotkeyFilter(QAbstractNativeEventFilter):
    """使用 Windows 消息队列接收全局快捷键，不依赖 keyboard 的键盘钩子。"""
    def __init__(self, callback):
        super().__init__()
        self.callback = callback
        self.is_registered = False

    def register(self, hotkey):
        self.unregister()
        modifiers, virtual_key = parse_hotkey(hotkey)
        if not ctypes.windll.user32.RegisterHotKey(None, HOTKEY_ID, modifiers, virtual_key):
            raise OSError("快捷键注册失败；它可能正被其他程序占用。请换一个快捷键。")
        self.is_registered = True

    def unregister(self):
        if self.is_registered:
            ctypes.windll.user32.UnregisterHotKey(None, HOTKEY_ID)
            self.is_registered = False

    def nativeEventFilter(self, event_type, message):
        if event_type in (b"windows_generic_MSG", b"windows_dispatcher_MSG"):
            msg = ctypes.cast(int(message), ctypes.POINTER(MSG)).contents
            if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
                self.callback()
                return True, 0
        return False, 0


class HostControlBridge(QObject):
    """Authenticated loopback control channel used by the Electron host."""

    command_received = pyqtSignal(dict)
    connected = pyqtSignal()
    disconnected = pyqtSignal()

    def __init__(self, port, token, host_pid):
        super().__init__()
        self.port = port
        self.token = token
        self.host_pid = host_pid
        self.socket = None
        self.write_lock = threading.Lock()
        self.running = True

    def start(self):
        threading.Thread(target=self._run, daemon=True).start()
        threading.Thread(target=self._watch_host, daemon=True).start()

    def _watch_host(self):
        """Exit even if a packaged Electron host is killed without closing TCP cleanly."""
        synchronize = 0x00100000
        wait_object_0 = 0x00000000
        infinite = 0xFFFFFFFF
        handle = ctypes.windll.kernel32.OpenProcess(synchronize, False, self.host_pid)
        if not handle:
            self.disconnected.emit()
            return
        try:
            result = ctypes.windll.kernel32.WaitForSingleObject(handle, infinite)
            if self.running and result == wait_object_0:
                self.disconnected.emit()
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)

    def _run(self):
        try:
            connection = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            connection.settimeout(None)
            self.socket = connection
            self.send({"type": "hello", "token": self.token, "protocol": 1})
            self.connected.emit()
            reader = connection.makefile("r", encoding="utf-8", newline="\n")
            for line in reader:
                if not self.running:
                    break
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict):
                    self.command_received.emit(message)
        except OSError:
            pass
        finally:
            self.disconnected.emit()

    def send(self, message):
        connection = self.socket
        if not connection:
            return
        payload = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        try:
            with self.write_lock:
                connection.sendall(payload)
        except OSError:
            pass

    def close(self):
        self.running = False
        connection, self.socket = self.socket, None
        if connection:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()


def load_config():
    if not CONFIG_PATH.exists():
        return normalize_profiles(copy.deepcopy(DEFAULT_CONFIG))
    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        config = {**DEFAULT_CONFIG, **json.load(file)}
    # 将早期示例配置中的无效润色自由文本自动升级为本工作流的枚举选项。
    legacy_polish = "保持原意，语气专业，表达清晰。"
    configured_actions = config.get("actions", [])
    action_ids = {item.get("id") for item in configured_actions if isinstance(item, dict)}
    is_two_action_legacy = len(configured_actions) == 2 and action_ids == {"summarize", "polish"}
    if is_two_action_legacy or any(item.get("how_polish") == legacy_polish for item in configured_actions if isinstance(item, dict)):
        config["actions"] = DEFAULT_CONFIG["actions"]
        config["polish_options"] = DEFAULT_CONFIG["polish_options"]
    return normalize_profiles(config)


def save_config(config):
    """保存本机设置；config.json 已被 .gitignore 排除。"""
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


class SettingsDialog(QDialog):
    def __init__(self, config, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Dify 工作流设置")
        self.setMinimumWidth(540)
        self.config = normalize_profiles(copy.deepcopy(config))
        config = self.config
        self.profiles = copy.deepcopy(config["profiles"])
        self.profile_selector = QComboBox()
        self.add_profile_button = QPushButton("新增")
        self.remove_profile_button = QPushButton("删除")
        selector_layout = QHBoxLayout()
        selector_layout.addWidget(self.profile_selector, 1)
        selector_layout.addWidget(self.add_profile_button)
        selector_layout.addWidget(self.remove_profile_button)
        self.profile_name = QLineEdit()
        self.profile_type = QComboBox()
        self.profile_type.addItem("Dify Workflow", "workflow")
        self.profile_type.addItem("直接调用 LLM（OpenAI 兼容）", "llm")
        self.base_url = QLineEdit()
        self.api_key = QLineEdit()
        self.api_key.setEchoMode(QLineEdit.EchoMode.Password)
        show_key = QCheckBox("显示 API Key")
        show_key.toggled.connect(lambda shown: self.api_key.setEchoMode(QLineEdit.EchoMode.Normal if shown else QLineEdit.EchoMode.Password))
        self.verify_tls = QCheckBox("验证 TLS 证书（本地自签名证书请取消勾选）")
        self.model = QLineEdit()
        self.model.setPlaceholderText("例如 gpt-4o-mini、deepseek-chat、Qwen/Qwen3-32B")
        self.user = QLineEdit(config["user"])
        self.hotkey = QKeySequenceEdit(QKeySequence(config["hotkey"], QKeySequence.SequenceFormat.PortableText))
        self.hotkey.setMaximumSequenceLength(1)
        form = QFormLayout()
        self.settings_form = form
        form.addRow("工作流配置", selector_layout)
        form.addRow("配置名称", self.profile_name)
        form.addRow("调用类型", self.profile_type)
        form.addRow("API Base URL", self.base_url)
        form.addRow("API Key", self.api_key)
        form.addRow("", show_key)
        form.addRow("TLS", self.verify_tls)
        form.addRow("模型名称", self.model)
        self.workflow_input_row = form.rowCount()
        self.workflow_input_label = QLabel("Input_Text、user_request、how_polish（已按工作流固定）")
        form.addRow("工作流输入", self.workflow_input_label)
        form.addRow("用户标识", self.user)
        form.addRow("唤起快捷键", self.hotkey)
        hint = QLabel("调用类型为 Dify Workflow 时使用 /workflows/run；直接调用 LLM 使用 OpenAI 兼容的 /chat/completions。LLM 模式必须填写模型名称。本机/私网地址默认信任自签名证书；仅应对可信服务取消 TLS 验证。")
        hint.setWordWrap(True)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(hint)
        layout.addWidget(buttons)
        self.profile_selector.currentIndexChanged.connect(self.load_profile)
        self.profile_type.currentIndexChanged.connect(self.update_mode_fields)
        self.add_profile_button.clicked.connect(self.add_profile)
        self.remove_profile_button.clicked.connect(self.remove_profile)
        self.populate_profiles()
        active_index = next((i for i, item in enumerate(self.profiles) if item["id"] == config["active_profile_id"]), 0)
        self.profile_selector.setCurrentIndex(active_index)
        self.load_profile(active_index)

    def populate_profiles(self):
        self.profile_selector.blockSignals(True)
        self.profile_selector.clear()
        self.profile_selector.addItems([profile["name"] for profile in self.profiles])
        self.profile_selector.blockSignals(False)

    def save_current_profile(self):
        index = self.profile_selector.currentIndex()
        if index < 0:
            return
        profile = self.profiles[index]
        profile.update({
            "name": self.profile_name.text().strip() or f"工作流 {index + 1}",
            "base_url": self.base_url.text().strip(),
            "api_key": self.api_key.text().strip(),
            "verify_tls": self.verify_tls.isChecked(),
            "mode": self.profile_type.currentData(),
            "model": self.model.text().strip(),
        })
        self.profile_selector.setItemText(index, profile["name"])

    def load_profile(self, index):
        if index < 0:
            return
        profile = self.profiles[index]
        self.profile_name.setText(profile["name"])
        self.base_url.setText(profile["base_url"])
        self.api_key.setText(profile["api_key"])
        self.verify_tls.setChecked(profile["verify_tls"])
        mode_index = self.profile_type.findData(profile["mode"])
        self.profile_type.setCurrentIndex(max(0, mode_index))
        self.model.setText(profile["model"])
        self.update_mode_fields()

    def update_mode_fields(self):
        is_llm = self.profile_type.currentData() == "llm"
        self.model.setEnabled(is_llm)
        self.model.setPlaceholderText("例如 gpt-4o-mini、deepseek-chat、Qwen/Qwen3-32B" if is_llm else "Dify Workflow 不需要填写模型名称")
        for role in (QFormLayout.ItemRole.LabelRole, QFormLayout.ItemRole.FieldRole):
            item = self.settings_form.itemAt(self.workflow_input_row, role)
            if item and item.widget():
                item.widget().setVisible(not is_llm)

    def add_profile(self):
        self.save_current_profile()
        profile = {
            "id": str(uuid.uuid4()), "name": f"工作流 {len(self.profiles) + 1}",
            "base_url": "https://api.dify.ai/v1", "api_key": "", "verify_tls": True,
            "mode": "workflow", "model": "",
        }
        self.profiles.append(profile)
        self.populate_profiles()
        self.profile_selector.setCurrentIndex(len(self.profiles) - 1)

    def remove_profile(self):
        if len(self.profiles) <= 1:
            QMessageBox.information(self, "保留一个配置", "至少需要保留一个工作流配置。")
            return
        index = self.profile_selector.currentIndex()
        self.profiles.pop(index)
        self.populate_profiles()
        self.profile_selector.setCurrentIndex(max(0, index - 1))

    def values(self):
        self.save_current_profile()
        return {
            "profiles": self.profiles,
            "active_profile_id": self.profiles[self.profile_selector.currentIndex()]["id"],
            "user": self.user.text().strip(),
            "hotkey": self.hotkey.keySequence().toString(QKeySequence.SequenceFormat.PortableText).strip().lower(),
        }


class WorkflowWorker(QObject):
    finished = pyqtSignal(str)
    failed = pyqtSignal(str)
    progress = pyqtSignal(str)
    request_ready = pyqtSignal(str)

    def __init__(self, config, text, action):
        super().__init__()
        self.config, self.text, self.action = config, text, action

    def run(self):
        try:
            profile = active_profile(self.config)
            if profile["mode"] == "llm":
                self.run_direct_llm(profile)
                return
            # 与 Dify 工作流 Start 节点变量一一对应：Input_Text、user_request、how_polish。
            inputs = {
                "Input_Text": self.text,
                "user_request": self.action.get("user_request", self.action.get("label", "")),
            }
            how_polish = self.action.get("how_polish", "").strip()
            if how_polish:
                inputs["how_polish"] = how_polish
            url = f"{api_base(profile['base_url'])}/workflows/run"
            payload = {"inputs": inputs, "response_mode": "streaming", "user": self.config["user"]}
            self.request_ready.emit(
                "请求地址：" + url + "\n输入参数：\n" + json.dumps(inputs, ensure_ascii=False, indent=2)
            )
            self.progress.emit("正在连接 Dify…")
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {profile['api_key']}",
                    "Content-Type": "application/json",
                    "User-Agent": "DifyDesktopAssistant/1.0",
                    "Accept-Encoding": "identity",
                    "Connection": "close",
                },
                json=payload,
                stream=True,
                timeout=(25, 600),
                verify=profile["verify_tls"],
            )
            response.raise_for_status()
            for raw_line in response.iter_lines(decode_unicode=True):
                if isinstance(raw_line, bytes):
                    raw_line = raw_line.decode("utf-8", errors="replace")
                if not raw_line or not raw_line.startswith("data:"):
                    continue
                try:
                    event = json.loads(raw_line[5:].strip())
                except json.JSONDecodeError:
                    continue
                event_name = event.get("event", "未知事件")
                data = event.get("data", {}) or {}
                self.progress.emit(f"Dify：{event_name}")
                if event_name == "workflow_finished":
                    result = first_output(data.get("outputs"))
                    if not result:
                        raise RuntimeError("工作流已完成，但未返回输出。请检查 End 节点的输出变量。")
                    self.finished.emit(result)
                    return
                if event_name in {"workflow_failed", "error"}:
                    raise RuntimeError(str(data.get("error") or data.get("message") or event))
            raise RuntimeError("Dify 连接已结束，但没有收到 workflow_finished 事件。")
        except requests.HTTPError as error:
            response = error.response
            detail = response.text if response is not None else str(error)
            try:
                detail = response.json().get("message") or detail
            except (ValueError, AttributeError):
                pass
            self.failed.emit(f"HTTP {response.status_code if response is not None else ''}：{detail}")
        except requests.RequestException as error:
            self.failed.emit(f"Dify 网络请求失败：{error}")
        except Exception as error:
            self.failed.emit(str(error))

    def run_direct_llm(self, profile):
        if not profile["model"]:
            raise ValueError("直接调用 LLM 时请在设置中填写模型名称。")
        url = chat_completions_url(profile["base_url"])
        messages = direct_llm_messages(self.text, self.action)
        payload = {"model": profile["model"], "messages": messages, "stream": True}
        self.request_ready.emit(
            "请求地址：" + url + "\n调用类型：直接 LLM（OpenAI 兼容）\n请求内容：\n"
            + json.dumps({"model": profile["model"], "messages": messages}, ensure_ascii=False, indent=2)
        )
        self.progress.emit("正在连接 LLM…")
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {profile['api_key']}", "Content-Type": "application/json", "Accept-Encoding": "identity"},
            json=payload,
            stream=True,
            timeout=(25, 600),
            verify=profile["verify_tls"],
        )
        response.raise_for_status()
        answer = []
        for raw_line in response.iter_lines(decode_unicode=True):
            if isinstance(raw_line, bytes):
                raw_line = raw_line.decode("utf-8", errors="replace")
            if not raw_line or not raw_line.startswith("data:"):
                continue
            data = raw_line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if event.get("error"):
                raise RuntimeError(str(event["error"]))
            for choice in event.get("choices", []):
                content = choice.get("delta", {}).get("content") or choice.get("message", {}).get("content")
                if isinstance(content, str):
                    answer.append(content)
        result = "".join(answer).strip()
        if not result:
            raise RuntimeError("LLM 未返回文本内容。请检查 API 地址、模型名称与兼容性。")
        self.finished.emit(result)


class ChatWorker(QObject):
    chunk = pyqtSignal(str)
    finished = pyqtSignal(str)
    failed = pyqtSignal(str)

    def __init__(self, profile, messages):
        super().__init__()
        self.profile = profile
        self.messages = messages
        self.cancelled = False

    def cancel(self):
        self.cancelled = True

    def run(self):
        try:
            url = chat_completions_url(self.profile["base_url"])
            response = requests.post(
                url,
                headers={"Authorization": f"Bearer {self.profile['api_key']}", "Content-Type": "application/json", "Accept-Encoding": "identity"},
                json={"model": self.profile["model"], "messages": self.messages, "stream": True},
                stream=True,
                timeout=(25, 600),
                verify=self.profile["verify_tls"],
            )
            response.raise_for_status()
            answer = []
            for raw_line in response.iter_lines(decode_unicode=True):
                if self.cancelled:
                    self.failed.emit("已停止生成。")
                    return
                if isinstance(raw_line, bytes):
                    raw_line = raw_line.decode("utf-8", errors="replace")
                if not raw_line or not raw_line.startswith("data:"):
                    continue
                data = raw_line[5:].strip()
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if event.get("error"):
                    raise RuntimeError(str(event["error"]))
                for choice in event.get("choices", []):
                    content = choice.get("delta", {}).get("content") or choice.get("message", {}).get("content")
                    if isinstance(content, str):
                        answer.append(content)
                        self.chunk.emit(content)
            result = "".join(answer).strip()
            if not result:
                raise RuntimeError("LLM 未返回文本内容。")
            self.finished.emit(result)
        except requests.HTTPError as error:
            response = error.response
            detail = response.text if response is not None else str(error)
            self.failed.emit(f"HTTP {response.status_code if response is not None else ''}：{detail}")
        except Exception as error:
            self.failed.emit(str(error))


class ChatWindow(QWidget):
    def __init__(self, assistant):
        super().__init__()
        self.assistant = assistant
        self.current_session_id = None
        self.streaming_text = ""
        self.worker_thread = None
        self.setWindowTitle("AI 对话 · Desktop Assistant")
        self.resize(1080, 740)
        self.setMinimumSize(840, 580)
        self.setStyleSheet("""
            QWidget { font-family:'Segoe UI Variable','Microsoft YaHei UI',sans-serif; color:#f9fafb; background:#111827; }
            QWidget#sidebar { background:#202124; border-right:1px solid #374151; }
            QLabel#eyebrow { color:#9ca3af; font-size:11px; font-weight:600; letter-spacing:1px; }
            QLabel#title { color:#f9fafb; font-size:20px; font-weight:650; letter-spacing:-.4px; }
            QLabel#badge { color:#12b886; font-size:12px; }
            QPushButton { background:transparent; color:#9ca3af; border:0; border-radius:7px; padding:8px 10px; }
            QPushButton:hover { color:#f9fafb; background:#374151; }
            QPushButton#primary { background:#4f46e5; color:#fff; font-weight:600; }
            QPushButton#primary:hover { background:#4338ca; }
            QComboBox,QLineEdit#search { color:#f9fafb; background:#111827; border:1px solid #374151; border-radius:9px; padding:7px 10px; }
            QComboBox QAbstractItemView { color:#f9fafb; background:#202124; selection-background-color:#4f46e5; }
            QListWidget { background:transparent; border:0; outline:0; padding:4px; }
            QListWidget::item { color:#9ca3af; border-radius:7px; padding:9px 10px; margin:2px 0; }
            QListWidget::item:hover { color:#f9fafb; background:#374151; }
            QListWidget::item:selected { color:#f9fafb; background:#312e81; border:1px solid #4f46e5; }
            QTextEdit#composer { color:#f9fafb; background:#202124; border:1px solid #374151; border-radius:14px; padding:10px; }
        """)
        self.profile_selector = QComboBox()
        self.badge = QLabel()
        self.badge.setObjectName("badge")
        self.new_button = QPushButton("＋ 新建对话")
        self.new_button.setObjectName("primary")
        self.search = QLineEdit()
        self.search.setObjectName("search")
        self.search.setPlaceholderText("搜索对话")
        self.session_list = QListWidget()
        self.rename_button = QPushButton("重命名")
        self.delete_button = QPushButton("删除")
        self.history = QTextBrowser()
        self.history.setReadOnly(True)
        self.history.setStyleSheet("QTextBrowser { background:#111827; border:0; padding:20px 48px; }")
        self.input = QTextEdit()
        self.input.setObjectName("composer")
        self.input.setPlaceholderText("输入消息…  Ctrl + Enter 发送，Shift + Enter 换行")
        self.input.setMaximumHeight(126)
        self.send_button = QPushButton("发送  ↑")
        self.send_button.setObjectName("primary")
        self.stop_button = QPushButton("停止")
        self.stop_button.hide()
        sidebar = QWidget()
        sidebar.setObjectName("sidebar")
        side = QVBoxLayout(sidebar)
        side.setContentsMargins(14, 18, 14, 14)
        eyebrow = QLabel("DESKTOP ASSISTANT")
        eyebrow.setObjectName("eyebrow")
        title = QLabel("AI 对话")
        title.setObjectName("title")
        side.addWidget(eyebrow)
        side.addWidget(title)
        side.addSpacing(12)
        side.addWidget(self.new_button)
        side.addWidget(self.search)
        side.addWidget(self.session_list, 1)
        session_actions = QHBoxLayout()
        session_actions.addWidget(self.rename_button)
        session_actions.addWidget(self.delete_button)
        side.addLayout(session_actions)
        top = QHBoxLayout()
        top.setContentsMargins(28, 18, 28, 8)
        top.addWidget(self.profile_selector, 1)
        top.addWidget(self.badge)
        bottom = QHBoxLayout()
        bottom.setContentsMargins(28, 8, 28, 22)
        bottom.addWidget(self.input, 1)
        bottom.addWidget(self.stop_button)
        bottom.addWidget(self.send_button)
        content = QWidget()
        content_layout = QVBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.addLayout(top)
        content_layout.addWidget(self.history, 1)
        content_layout.addLayout(bottom)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setHandleWidth(1)
        splitter.addWidget(sidebar)
        splitter.addWidget(content)
        splitter.setSizes([245, 835])
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(splitter)
        self.send_button.clicked.connect(self.send_message)
        self.stop_button.clicked.connect(self.stop_generation)
        self.new_button.clicked.connect(self.new_session)
        self.rename_button.clicked.connect(self.rename_session)
        self.delete_button.clicked.connect(self.delete_session)
        self.search.textChanged.connect(self.populate_sessions)
        self.session_list.itemSelectionChanged.connect(self.load_session)
        self.profile_selector.currentIndexChanged.connect(self.change_profile)
        self.input.installEventFilter(self)

    def refresh_profiles(self):
        selected_id = self.profile_selector.currentData()
        self.profile_selector.blockSignals(True)
        self.profile_selector.clear()
        for profile in self.assistant.config["profiles"]:
            # 兼容早期保存时尚未写入 mode、但已经填写模型名称的直接 LLM 配置。
            if profile.get("mode") == "llm" or profile.get("model"):
                host = urlparse(profile["base_url"] if "://" in profile["base_url"] else "https://" + profile["base_url"]).hostname or "本地服务"
                self.profile_selector.addItem(f"{profile.get('model') or 'LLM'}  ·  {host}", profile["id"])
        self.profile_selector.blockSignals(False)
        active_id = self.assistant.config["active_profile_id"]
        target = self.profile_selector.findData(selected_id if self.profile_selector.findData(selected_id) >= 0 else active_id)
        self.profile_selector.setCurrentIndex(target if target >= 0 else 0)
        if self.profile_selector.count() == 0:
            self.history.setPlainText("没有可用的直接 LLM 配置。请在设置中新增并选择“直接调用 LLM（OpenAI 兼容）”。")
            self.input.setEnabled(False)
            self.send_button.setEnabled(False)
        else:
            self.input.setEnabled(True)
            self.send_button.setEnabled(True)
            self.update_badge()
            self.populate_sessions()
            if not self.current_session_id:
                self.new_session()

    def change_profile(self):
        profile_id = self.profile_selector.currentData()
        if profile_id:
            self.assistant.select_profile(profile_id)
            self.update_badge()

    def update_badge(self):
        profile = self.profile()
        self.badge.setText(f"● 已连接 {profile['model']}" if profile else "○ 未配置模型")

    def profile(self):
        profile_id = self.profile_selector.currentData()
        return next((item for item in self.assistant.config["profiles"] if item["id"] == profile_id), None)

    def sessions(self):
        return self.assistant.config.setdefault("chat_sessions", [])

    def save_sessions(self):
        save_config(self.assistant.config)

    def populate_sessions(self):
        active = self.current_session_id
        query = self.search.text().strip().lower()
        self.session_list.blockSignals(True)
        self.session_list.clear()
        for session in sorted(self.sessions(), key=lambda item: item.get("updated_at", ""), reverse=True):
            if query and query not in session.get("title", "").lower():
                continue
            item = QListWidgetItem(session.get("title") or "新对话")
            item.setData(Qt.ItemDataRole.UserRole, session["id"])
            self.session_list.addItem(item)
            if session["id"] == active:
                self.session_list.setCurrentItem(item)
        self.session_list.blockSignals(False)

    def new_session(self):
        session = {"id": str(uuid.uuid4()), "title": "新对话", "profile_id": self.profile_selector.currentData(), "messages": [], "updated_at": str(time.time())}
        self.sessions().append(session)
        self.current_session_id = session["id"]
        self.save_sessions()
        self.populate_sessions()
        self.render_messages()

    def session(self):
        return next((item for item in self.sessions() if item["id"] == self.current_session_id), None)

    def load_session(self):
        item = self.session_list.currentItem()
        if not item:
            return
        self.current_session_id = item.data(Qt.ItemDataRole.UserRole)
        session = self.session()
        index = self.profile_selector.findData(session.get("profile_id"))
        if index >= 0:
            self.profile_selector.setCurrentIndex(index)
        self.render_messages()

    def rename_session(self):
        session = self.session()
        if not session:
            return
        title, ok = QInputDialog.getText(self, "重命名对话", "名称：", text=session["title"])
        if ok and title.strip():
            session["title"] = title.strip()
            session["updated_at"] = str(time.time())
            self.save_sessions()
            self.populate_sessions()

    def delete_session(self):
        session = self.session()
        if not session:
            return
        if QMessageBox.question(self, "删除对话", f"删除“{session['title']}”？") != QMessageBox.StandardButton.Yes:
            return
        self.assistant.config["chat_sessions"] = [item for item in self.sessions() if item["id"] != session["id"]]
        self.current_session_id = None
        self.save_sessions()
        self.populate_sessions()
        self.new_session()

    def send_message(self):
        if self.worker_thread is not None and self.worker_thread.isRunning():
            return
        profile_id = self.profile_selector.currentData()
        if not profile_id:
            return
        profile = self.profile()
        message = self.input.toPlainText().strip()
        if not message:
            return
        if not profile["api_key"] or not profile["model"]:
            QMessageBox.warning(self, "配置不完整", "请在设置中填写该 LLM 的 API Key 和模型名称。")
            return
        self.input.clear()
        session = self.session()
        if not session:
            self.new_session()
            session = self.session()
        session["profile_id"] = profile_id
        session["messages"].append({"role": "user", "content": message})
        if session["title"] == "新对话":
            session["title"] = message.replace("\n", " ")[:28]
        session["updated_at"] = str(time.time())
        self.streaming_text = ""
        self.save_sessions()
        self.populate_sessions()
        self.render_messages()
        self.send_button.setEnabled(False)
        self.stop_button.show()
        self.worker_thread = QThread(self)
        self.worker = ChatWorker(profile, list(session["messages"]))
        self.worker.moveToThread(self.worker_thread)
        self.worker_thread.started.connect(self.worker.run)
        self.worker.chunk.connect(self.append_chunk)
        self.worker.finished.connect(self.finish_message)
        self.worker.failed.connect(self.fail_message)
        self.worker.finished.connect(self.worker_thread.quit)
        self.worker.failed.connect(self.worker_thread.quit)
        self.worker_thread.finished.connect(self.worker.deleteLater)
        self.worker_thread.finished.connect(self.finish_thread)
        self.worker_thread.start()

    def append_chunk(self, text):
        self.streaming_text += text
        self.render_messages()

    def finish_message(self, answer):
        session = self.session()
        if session:
            session["messages"].append({"role": "assistant", "content": answer})
            session["updated_at"] = str(time.time())
            self.save_sessions()
        self.streaming_text = ""
        self.render_messages()

    def fail_message(self, error):
        self.streaming_text = ""
        self.history.append(f"<p style='color:#b42318'>调用失败：{html.escape(error)}</p>")

    def finish_thread(self):
        self.send_button.setEnabled(True)
        self.stop_button.hide()
        self.worker = None

    def stop_generation(self):
        if getattr(self, "worker", None):
            self.worker.cancel()
            self.stop_button.setEnabled(False)

    def render_messages(self):
        session = self.session()
        messages = session.get("messages", []) if session else []
        blocks = []
        if not messages and not self.streaming_text:
            blocks.append("<div class='empty'><h1>从一个问题开始</h1><p>选择模型后，输入消息即可开始对话。</p></div>")
        for message in messages:
            role = message.get("role")
            content = html.escape(str(message.get("content", ""))).replace("\n", "<br>")
            blocks.append(f"<section class='message {role}'><div class='label'>{'你' if role == 'user' else 'AI'}</div><div class='bubble'>{content}</div></section>")
        if self.streaming_text:
            content = html.escape(self.streaming_text).replace("\n", "<br>")
            blocks.append(f"<section class='message assistant'><div class='label'>AI</div><div class='bubble'>{content}<span class='cursor'>▍</span></div></section>")
        document = """<html><head><style>body{font-family:'Segoe UI Variable','Microsoft YaHei UI',sans-serif;color:#f9fafb;background:#111827}.message{max-width:720px;margin:0 auto 24px}.label{font-size:12px;color:#9ca3af;margin:0 0 6px 6px;font-weight:600}.bubble{padding:14px 16px;border-radius:14px;background:#202124;border:1px solid #374151;line-height:1.65;font-size:15px}.user{text-align:right}.user .label{margin-right:6px}.user .bubble{display:inline-block;text-align:left;max-width:84%;background:#4f46e5;color:#fff;border-color:#4f46e5}.empty{max-width:620px;margin:110px auto;text-align:center;color:#9ca3af}.empty h1{color:#f9fafb;font-size:28px}.cursor{color:#818cf8}</style></head><body>""" + "".join(blocks) + "</body></html>"
        self.history.setHtml(document)
        self.history.verticalScrollBar().setValue(self.history.verticalScrollBar().maximum())

    def eventFilter(self, watched, event):
        if watched is self.input and event.type() == QEvent.Type.KeyPress and event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self.send_message()
            return True
        return super().eventFilter(watched, event)

    def closeEvent(self, event):
        event.ignore()
        self.hide()


class FloatingAssistant(QWidget):
    selected_text_ready = pyqtSignal(str)

    def __init__(self, config, hotkey_filter):
        super().__init__()
        self.config = config
        self.hotkey_filter = hotkey_filter
        self.selected_text = ""
        self.result = ""
        self.worker_thread = None
        self.host_bridge = None
        self.drag_offset = None
        self.hotkey_error = ""
        self.setup_ui()
        self.selected_text_ready.connect(self.show_actions)
        try:
            self.register_hotkey()
        except OSError as error:
            self.hotkey_error = str(error)

    def register_hotkey(self):
        self.hotkey_filter.register(self.config["hotkey"])

    def update_config(self, config):
        previous_config = self.config
        self.config = config
        try:
            self.register_hotkey()
        except Exception:
            self.config = previous_config
            self.register_hotkey()
            raise

    def select_profile(self, profile_id):
        if profile_id == self.config["active_profile_id"]:
            return
        if profile_id not in {profile["id"] for profile in self.config["profiles"]}:
            return
        self.config["active_profile_id"] = profile_id
        save_config(self.config)

    def setup_ui(self):
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setFixedWidth(420)
        self.panel = QWidget()
        self.panel.setObjectName("panel")
        self.panel.setStyleSheet("""
            QWidget#panel { background:#111827; border:1px solid #374151; border-radius:12px; }
            QLabel { color:#f9fafb; }
            QLabel#title { font-size:16px; font-weight:600; }
            QLabel#hint { color:#9ca3af; font-size:12px; }
            QLabel#selectionBadge { color:#a5b4fc; background:#312e81; border-radius:5px; padding:2px 6px; font-size:10px; font-weight:600; }
            QLabel#preview { color:#f9fafb; background:#202124; border:1px solid #374151; border-radius:9px; padding:12px; font-size:13px; }
            QPushButton { background:#374151; color:#f9fafb; border:1px solid transparent; border-radius:7px; padding:9px 12px; text-align:left; }
            QPushButton:hover { background:#4f46e5; border-color:#6366f1; }
            QPushButton#primary { background:#4f46e5; color:#ffffff; font-weight:600; }
            QPushButton#primary:hover { background:#4338ca; }
            QPushButton#dismiss { background: transparent; color: #9ca3af; font-size: 20px; padding: 0; }
            QPushButton#dismiss:hover { color: #ffffff; background: #374151; }
            QTextEdit { background:#202124; color:#f9fafb; border:1px solid #374151; border-radius:9px; padding:10px; selection-background-color:#4f46e5; }
        """)
        self.title = QLabel("AI 划词助手")
        self.title.setObjectName("title")
        self.dismiss_button = QPushButton("×")
        self.dismiss_button.setObjectName("dismiss")
        self.dismiss_button.setToolTip("隐藏到系统托盘")
        self.dismiss_button.setFixedSize(28, 28)
        self.dismiss_button.clicked.connect(self.hide)
        self.hint = QLabel(f"选中文字后按 {self.config['hotkey']} 唤起")
        self.hint.setObjectName("hint")
        self.selection_badge = QLabel("已选中文本")
        self.selection_badge.setObjectName("selectionBadge")
        self.selection_badge.hide()
        self.preview = QLabel()
        self.preview.setObjectName("preview")
        self.preview.setWordWrap(True)
        self.request_view = QTextEdit()
        self.request_view.setReadOnly(True)
        self.request_view.setMaximumHeight(120)
        self.request_view.hide()
        self.actions_layout = QGridLayout()
        self.actions_layout.setSpacing(6)
        self.result_view = QTextEdit()
        self.result_view.setReadOnly(True)
        self.result_view.hide()
        self.copy_button = QPushButton("复制结果")
        self.replace_button = QPushButton("替换原文")
        self.replace_button.setObjectName("primary")
        self.chatbox_button = QPushButton("在完整对话中继续")
        self.close_button = QPushButton("关闭")
        self.close_button.clicked.connect(self.hide)
        self.copy_button.clicked.connect(self.copy_result)
        self.replace_button.clicked.connect(self.replace_selection)
        self.chatbox_button.clicked.connect(self.continue_in_chatbox)
        self.bottom_layout = QHBoxLayout()
        self.bottom_layout.addWidget(self.copy_button)
        self.bottom_layout.addWidget(self.replace_button)
        self.bottom_layout.addWidget(self.chatbox_button)
        self.bottom_layout.addStretch()
        self.bottom_layout.addWidget(self.close_button)
        self.bottom_widget = QWidget()
        self.bottom_widget.setLayout(self.bottom_layout)
        self.bottom_widget.hide()
        layout = QVBoxLayout(self.panel)
        layout.setContentsMargins(16, 14, 16, 14)
        header = QHBoxLayout()
        header.addWidget(self.title)
        header.addStretch()
        header.addWidget(self.dismiss_button)
        layout.addLayout(header)
        status_row = QHBoxLayout()
        status_row.setSpacing(8)
        status_row.addWidget(self.hint)
        status_row.addWidget(self.selection_badge)
        status_row.addStretch()
        layout.addLayout(status_row)
        layout.addWidget(self.preview)
        layout.addWidget(self.request_view)
        layout.addLayout(self.actions_layout)
        layout.addWidget(self.result_view)
        layout.addWidget(self.bottom_widget)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.addWidget(self.panel)
        for widget in (self.panel, self.title, self.hint, self.preview):
            widget.installEventFilter(self)
        self.action_buttons = []

    def eventFilter(self, watched, event):
        """为无边框浮窗补充拖动行为，按钮和结果框仍保持正常点击/选择。"""
        if watched in (self.panel, self.title, self.hint, self.preview):
            if event.type() == QEvent.Type.MouseButtonPress and event.button() == Qt.MouseButton.LeftButton:
                self.drag_offset = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
                return True
            if event.type() == QEvent.Type.MouseMove and self.drag_offset is not None and event.buttons() & Qt.MouseButton.LeftButton:
                self.move(event.globalPosition().toPoint() - self.drag_offset)
                return True
            if event.type() == QEvent.Type.MouseButtonRelease:
                self.drag_offset = None
                return True
        return super().eventFilter(watched, event)

    def capture_selection(self):
        """复制当前选区；用哨兵值防止复制失败时误用历史剪贴板文本。"""
        def copy_and_emit():
            try:
                original = pyperclip.paste()
                sentinel = "__DIFY_DESKTOP_SELECTION_SENTINEL__"
                pyperclip.copy(sentinel)
                # RegisterHotKey 消息可能早于 Ctrl/Alt 键松开到达，先等待后再发送 Ctrl+C。
                time.sleep(0.25)
                keyboard.send("ctrl+c")
                text = ""
                for _ in range(16):
                    time.sleep(0.05)
                    candidate = pyperclip.paste()
                    if candidate != sentinel:
                        text = candidate.strip()
                        break
                pyperclip.copy(original)
                self.selected_text_ready.emit(text)
            except Exception:
                self.selected_text_ready.emit("")
        threading.Thread(target=copy_and_emit, daemon=True).start()

    def show_actions(self, text):
        if not text:
            self.show_message("未获取到选中文本", "请先在目标应用中选中文本，再按快捷键。")
            return
        self.selected_text = text
        self.result = ""
        self.title.setText("AI 划词助手")
        self.result_view.hide()
        self.request_view.hide()
        self.bottom_widget.hide()
        self.selection_badge.show()
        self.preview.setText(f"{html.escape(text[:180])}{'…' if len(text) > 180 else ''}")
        self.hint.setText("选择一个操作")
        self.set_action_buttons(self.config["actions"])
        self.move_near_cursor()
        self.show()
        self.raise_()
        self.activateWindow()
        self.setFocus(Qt.FocusReason.ShortcutFocusReason)

    def set_action_buttons(self, actions):
        self.action_buttons = []
        while self.actions_layout.count():
            item = self.actions_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        for index, action in enumerate(actions):
            shortcut = str(index + 1) if index < 9 else ""
            button = QPushButton(f"{action['label']}    {shortcut}")
            button.setToolTip(f"按 {shortcut} 快速执行" if shortcut else action["label"])
            button.clicked.connect(lambda _, a=action: self.handle_action(a))
            self.actions_layout.addWidget(button, index // 3, index % 3)
            self.action_buttons.append((button, action))

    def keyPressEvent(self, event):
        if Qt.Key.Key_1.value <= event.key() <= Qt.Key.Key_9.value:
            index = event.key() - Qt.Key.Key_1.value
            if index < len(self.action_buttons):
                self.handle_action(self.action_buttons[index][1])
                return
        if event.key() == Qt.Key.Key_Escape:
            self.hide()
            return
        super().keyPressEvent(event)

    def handle_action(self, action):
        if action.get("id") == "back":
            self.show_actions(self.selected_text)
        elif action.get("submenu") == "polish":
            self.show_polish_options()
        else:
            self.run_workflow(action)

    def show_polish_options(self):
        self.hint.setText("选择润色方式")
        options = [
            {
                "id": f"polish_{index}",
                "label": option["label"],
                "user_request": "润色",
                "how_polish": option["how_polish"],
            }
            for index, option in enumerate(self.config["polish_options"])
        ]
        options.append({"id": "back", "label": "返回"})
        self.set_action_buttons(options)
        self.adjustSize()

    def run_workflow(self, action):
        if self.host_bridge:
            self.hint.setText(f"正在执行“{action['label']}”…")
            for index in range(self.actions_layout.count()):
                self.actions_layout.itemAt(index).widget().setEnabled(False)
            self.host_bridge.send({
                "type": "event",
                "event": "runAction",
                "requestId": str(uuid.uuid4()),
                "text": self.selected_text,
                "action": action,
            })
            return
        profile = active_profile(self.config)
        if not profile["api_key"]:
            self.show_message("尚未配置 Dify", "请在系统托盘菜单中打开“设置”，填写 Workflow API Key。")
            return
        self.hint.setText(f"正在通过“{profile['name']}”执行“{action['label']}”…")
        for index in range(self.actions_layout.count()):
            self.actions_layout.itemAt(index).widget().setEnabled(False)
        self.worker_thread = QThread(self)
        self.worker = WorkflowWorker(self.config, self.selected_text, action)
        self.worker.moveToThread(self.worker_thread)
        self.worker_thread.started.connect(self.worker.run)
        self.worker.finished.connect(self.show_result)
        self.worker.failed.connect(self.show_failure)
        self.worker.progress.connect(self.set_progress)
        self.worker.request_ready.connect(self.show_request_details)
        self.worker.finished.connect(self.worker_thread.quit)
        self.worker.failed.connect(self.worker_thread.quit)
        self.worker_thread.finished.connect(self.worker.deleteLater)
        self.worker_thread.finished.connect(self.clear_worker)
        self.worker_thread.start()

    def set_progress(self, message):
        self.hint.setText(message)

    def show_request_details(self, details):
        self.request_view.setPlainText(details)
        self.request_view.show()
        self.adjustSize()

    def clear_worker(self):
        self.worker = None

    def show_failure(self, error):
        self.title.setText("调用失败")
        self.hint.setText("请检查下方请求参数和错误信息")
        self.selection_badge.hide()
        self.result_view.setPlainText(error)
        self.result_view.show()
        self.bottom_widget.hide()
        self.adjustSize()

    def show_result(self, result):
        self.result = result
        self.hint.setText("已完成")
        self.selection_badge.hide()
        self.result_view.setPlainText(result)
        self.result_view.show()
        self.bottom_widget.show()
        self.adjustSize()

    def show_message(self, title, message):
        self.title.setText(title)
        self.hint.setText(message)
        self.selection_badge.hide()
        self.preview.clear()
        self.request_view.hide()
        self.result_view.hide()
        self.bottom_widget.hide()
        self.move_near_cursor()
        self.show()

    def copy_result(self):
        pyperclip.copy(self.result)
        self.hint.setText("结果已复制")

    def continue_in_chatbox(self):
        """将当前结果预填到完整对话窗口；用户仍需自行确认是否发送。"""
        text = self.result or self.selected_text
        if not text:
            self.hint.setText("没有可继续的内容")
            return
        try:
            webbrowser.open(f"desktopassistant://assistant/compose?text={quote(text)}")
            self.hint.setText("已在完整对话中打开草稿")
        except Exception as error:
            self.hint.setText(f"无法打开完整对话：{error}")

    def replace_selection(self):
        if not self.result:
            return
        pyperclip.copy(self.result)
        self.hide()
        keyboard.send("ctrl+v")

    def move_near_cursor(self):
        point = QCursor.pos() + QPoint(12, 16)
        screen = QApplication.screenAt(point) or QApplication.primaryScreen()
        available = screen.availableGeometry()
        self.adjustSize()
        point.setX(min(point.x(), available.right() - self.width()))
        point.setY(min(point.y(), available.bottom() - self.height()))
        self.move(point)


class TrayController(QObject):
    def __init__(self, assistant):
        super().__init__()
        self.assistant = assistant
        self.chat_window = ChatWindow(assistant)
        icon_path = resource_path("nucwise-nid-icon-imagen-v1-transparent.ico")
        tray_icon = QIcon(str(icon_path)) if icon_path.exists() else QApplication.style().standardIcon(
            QStyle.StandardPixmap.SP_ComputerIcon
        )
        self.tray = QSystemTrayIcon(tray_icon)
        self.menu = QMenu()
        show_action = self.menu.addAction("显示助手")
        chat_action = self.menu.addAction("打开完整对话…")
        self.workflow_menu = self.menu.addMenu("切换工作流")
        settings_action = self.menu.addAction("设置…")
        self.menu.addSeparator()
        quit_action = self.menu.addAction("退出")
        show_action.triggered.connect(self.show_assistant)
        # QAction.triggered emits a boolean. Do not pass it as the URL text.
        chat_action.triggered.connect(lambda _checked=False: self.open_chatbox())
        settings_action.triggered.connect(self.open_settings)
        quit_action.triggered.connect(QApplication.quit)
        self.workflow_menu.aboutToShow.connect(self.refresh_workflow_menu)
        self.refresh_workflow_menu()
        self.tray.setContextMenu(self.menu)
        self.tray.activated.connect(self.on_activated)
        self.tray.show()

    def on_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.show_assistant()

    def show_assistant(self):
        profile = active_profile(self.assistant.config)
        self.assistant.show_message("AI 划词助手", f"当前工作流：{profile['name']}；选中文字后按 {self.assistant.config['hotkey']} 唤起")

    def open_chatbox(self, text=""):
        """唤起完整对话窗口；文本只预填，不会在未经确认时发送。"""
        text = text if isinstance(text, str) else ""
        try:
            webbrowser.open(f"desktopassistant://assistant/compose?text={quote(text)}")
        except Exception as error:
            QMessageBox.warning(None, "无法打开完整对话", f"请先启动 Desktop AI Assistant 主程序。\n{error}")

    def refresh_workflow_menu(self):
        self.workflow_menu.clear()
        for profile in self.assistant.config["profiles"]:
            action = self.workflow_menu.addAction(profile["name"])
            action.setCheckable(True)
            action.setChecked(profile["id"] == self.assistant.config["active_profile_id"])
            action.triggered.connect(lambda _, profile_id=profile["id"]: self.switch_profile(profile_id))

    def switch_profile(self, profile_id):
        self.assistant.select_profile(profile_id)
        profile = active_profile(self.assistant.config)
        self.tray.showMessage("AI 划词助手", f"已切换到：{profile['name']}。", QSystemTrayIcon.MessageIcon.Information, 2000)

    def open_settings(self):
        dialog = SettingsDialog(self.assistant.config, self.assistant)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        updates = dialog.values()
        selected_profile = next(profile for profile in updates["profiles"] if profile["id"] == updates["active_profile_id"])
        if not all((selected_profile["base_url"], updates["user"], updates["hotkey"])):
            QMessageBox.warning(dialog, "设置不完整", "当前工作流的 API 地址、用户标识和快捷键均不能为空。")
            return
        if selected_profile["mode"] == "llm" and not selected_profile["model"]:
            QMessageBox.warning(dialog, "设置不完整", "直接调用 LLM 时必须填写模型名称。")
            return
        config = {**self.assistant.config, **updates}
        try:
            self.assistant.update_config(config)
            save_config(config)
            self.refresh_workflow_menu()
            self.chat_window.refresh_profiles()
            self.tray.showMessage("AI 划词助手", "设置已保存。", QSystemTrayIcon.MessageIcon.Information, 2500)
        except ValueError as error:
            QMessageBox.warning(dialog, "快捷键无效", f"无法注册快捷键：{error}")


def hosted_arguments(argv):
    """Return host connection arguments without adding another CLI dependency."""
    if "--hosted" not in argv:
        return None
    try:
        port = int(argv[argv.index("--control-port") + 1])
        token = argv[argv.index("--control-token") + 1]
        host_pid = int(argv[argv.index("--host-pid") + 1])
    except (ValueError, IndexError):
        return None
    return port, token, host_pid


def main():
    try:
        config = load_config()
    except json.JSONDecodeError as error:
        print(f"配置错误：{error}")
        return 1
    app = QApplication(sys.argv)
    app_icon_path = resource_path("nucwise-nid-icon-imagen-v1-transparent.ico")
    if app_icon_path.exists():
        app.setWindowIcon(QIcon(str(app_icon_path)))
    app.setQuitOnLastWindowClosed(False)
    hotkey_filter = GlobalHotkeyFilter(lambda: assistant.capture_selection())
    app.installNativeEventFilter(hotkey_filter)
    assistant = FloatingAssistant(config, hotkey_filter)
    app.hotkey_filter = hotkey_filter  # 保持原生事件过滤器在整个应用生命周期内存活
    hosted = hosted_arguments(sys.argv)
    if hosted:
        bridge = HostControlBridge(*hosted)
        assistant.host_bridge = bridge

        def handle_command(message):
            command = message.get("command")
            request_id = message.get("id")
            if command == "showAssistant":
                profile = active_profile(assistant.config)
                message = f"当前工作流：{profile['name']}；选中文字后按 {assistant.config['hotkey']} 唤起"
                if assistant.hotkey_error:
                    message = f"快捷键 {assistant.config['hotkey']} 已被占用；请从主程序托盘捕获选区，或在设置中更换快捷键。"
                assistant.show_message("AI 划词助手", message)
            elif command == "captureSelection":
                assistant.capture_selection()
            elif command == "hideAssistant":
                assistant.hide()
            elif command == "actionProgress":
                assistant.set_progress(str(message.get("message") or "正在执行…"))
            elif command == "actionResult":
                if message.get("ok"):
                    assistant.show_result(str(message.get("result") or ""))
                else:
                    assistant.show_failure(str(message.get("error") or "调用失败"))
            elif command == "shutdown":
                bridge.send({"type": "response", "id": request_id, "ok": True})
                bridge.close()
                QApplication.quit()
                return
            else:
                bridge.send({"type": "response", "id": request_id, "ok": False, "error": "unknown command"})
                return
            bridge.send({"type": "response", "id": request_id, "ok": True})

        bridge.command_received.connect(handle_command)
        bridge.disconnected.connect(QApplication.quit)
        assistant.selected_text_ready.connect(
            lambda text: bridge.send({"type": "event", "event": "selectionCaptured", "text": text})
        )
        bridge.connected.connect(lambda: bridge.send({
            "type": "event",
            "event": "ready",
            "hotkeyRegistered": not bool(assistant.hotkey_error),
            "hotkeyError": assistant.hotkey_error,
        }))
        bridge.start()
        app.host_control_bridge = bridge
    else:
        tray = TrayController(assistant)
        app.tray_controller = tray  # 独立开发运行时保留托盘入口
        if not QSystemTrayIcon.isSystemTrayAvailable():
            assistant.show_message("AI 划词助手", f"选中文字后按 {config['hotkey']} 唤起")
        elif not active_profile(config)["api_key"]:
            tray.tray.showMessage("AI 划词助手", "请右键托盘图标，打开“设置”填写 Dify API Key。", QSystemTrayIcon.MessageIcon.Information, 5000)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
