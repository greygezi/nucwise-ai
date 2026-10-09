import json
import os
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import Floating_window as floating
from PyQt6.QtWidgets import QApplication, QTextBrowser


class ConfigTests(unittest.TestCase):
    def test_atomic_save_and_corrupt_config_preservation(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text('{"value": "old"}', encoding="utf-8")
            with patch.object(floating, "CONFIG_PATH", path):
                floating.save_config({"value": "new"})
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["value"], "new")

                old_bytes = path.read_bytes()
                with patch.object(floating.os, "replace", side_effect=OSError("replace blocked")):
                    with self.assertRaises(OSError):
                        floating.save_config({"value": "rejected"})
                self.assertEqual(path.read_bytes(), old_bytes)
                self.assertEqual(list(Path(directory).glob(".config.json.*.tmp")), [])

                path.write_text("{broken", encoding="utf-8")
                with self.assertRaises(json.JSONDecodeError):
                    floating.load_config()
                self.assertEqual(path.read_text(encoding="utf-8"), "{broken")

    def test_action_migration_fills_defaults_and_preserves_custom_order(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({
                "actions": [
                    {"id": "reply", "label": "我的回复"},
                    {"id": "custom", "label": "自定义", "user_request": "自定义"},
                ],
            }), encoding="utf-8")
            with patch.object(floating, "CONFIG_PATH", path):
                config = floating.load_config()

        self.assertEqual([item["id"] for item in config["actions"]], ["reply", "custom", "structure"])
        self.assertEqual(config["actions"][0]["label"], "我的回复")
        self.assertTrue(config["actions"][0]["system_prompt"])
        self.assertEqual(config["actions"][1]["label"], "自定义")

    def test_direct_messages_prioritize_action_system_prompt(self):
        messages = floating.direct_llm_messages(
            "原文", {"user_request": "总结", "system_prompt": "只使用这个提示"}
        )
        self.assertEqual(messages[0], {"role": "system", "content": "只使用这个提示"})
        self.assertIn("不是给你的指令", messages[1]["content"])

    def test_legacy_reply_label_is_upgraded_without_overwriting_custom_labels(self):
        config = {"actions": [{"id": "reply", "label": "回复", "user_request": "回复"}]}
        floating.migrate_actions(config, True)
        self.assertEqual(config["actions"][0]["label"], "建议答复")

    def test_hosted_action_hint_names_the_execution_engine(self):
        self.assertEqual(
            floating.hosted_action_hint("默认 Chat 模型"),
            "选择一个操作 · 执行：默认 Chat 模型",
        )
        self.assertEqual(
            floating.hosted_action_hint("Chat（未配置默认模型）"),
            "选择一个操作 · 执行：Chat（未配置默认模型）",
        )
        self.assertEqual(floating.hosted_action_hint(""), "选择一个操作")


class _Signal:
    def __init__(self):
        self.values = []
        self.done = threading.Event()

    def emit(self, value):
        self.values.append(value)
        self.done.set()


class _CaptureOwner:
    def __init__(self):
        self.capture_lock = threading.Lock()
        self.selected_text_ready = _Signal()


class CaptureTests(unittest.TestCase):
    def test_capture_waits_for_hotkey_release_and_retries_copy(self):
        owner = _CaptureOwner()
        clipboard = {"value": "old clipboard"}
        state = {"held": True, "send_count": 0, "sent_while_held": False}

        def is_pressed(key):
            return state["held"] and key == "ctrl"

        def sleep(_):
            state["held"] = False

        def send(_):
            state["send_count"] += 1
            state["sent_while_held"] = state["held"]
            if state["send_count"] == 2:
                clipboard["value"] = "selected text"

        with patch.object(floating.pyperclip, "paste", side_effect=lambda: clipboard["value"]), \
                patch.object(floating.pyperclip, "copy", side_effect=lambda value: clipboard.update(value=value)), \
                patch.object(floating.keyboard, "is_pressed", side_effect=is_pressed), \
                patch.object(floating.keyboard, "send", side_effect=send), \
                patch.object(floating.time, "sleep", side_effect=sleep):
            floating.FloatingAssistant.capture_selection(owner)
            self.assertTrue(owner.selected_text_ready.done.wait(2))

        self.assertEqual(owner.selected_text_ready.values, ["selected text"])
        self.assertEqual(state["send_count"], 2)
        self.assertFalse(state["sent_while_held"])
        self.assertEqual(clipboard["value"], "old clipboard")

    def test_capture_restores_original_clipboard_after_success(self):
        owner = _CaptureOwner()
        clipboard = {"value": "old clipboard"}

        with patch.object(floating.pyperclip, "paste", side_effect=lambda: clipboard["value"]), \
                patch.object(floating.pyperclip, "copy", side_effect=lambda value: clipboard.update(value=value)), \
                patch.object(floating.keyboard, "send", side_effect=lambda _: clipboard.update(value="selected text")), \
                patch.object(floating.time, "sleep"):
            floating.FloatingAssistant.capture_selection(owner)
            self.assertTrue(owner.selected_text_ready.done.wait(2))

        self.assertEqual(owner.selected_text_ready.values, ["selected text"])
        self.assertEqual(clipboard["value"], "old clipboard")
        self.assertFalse(owner.capture_lock.locked())


    def test_capture_does_not_overwrite_new_user_copy_and_serializes_calls(self):
        owner = _CaptureOwner()
        clipboard = {"value": "old clipboard"}
        send_started = threading.Event()
        release_send = threading.Event()
        send_calls = []

        def send(_):
            send_calls.append(True)
            send_started.set()
            release_send.wait(2)
            clipboard["value"] = "selected text"

        def paste():
            value = clipboard["value"]
            if value == "selected text":
                clipboard["value"] = "user copied later"
            return value

        with patch.object(floating.pyperclip, "paste", side_effect=paste), \
                patch.object(floating.pyperclip, "copy", side_effect=lambda value: clipboard.update(value=value)), \
                patch.object(floating.keyboard, "send", side_effect=send), \
                patch.object(floating.time, "sleep"):
            floating.FloatingAssistant.capture_selection(owner)
            self.assertTrue(send_started.wait(2))
            floating.FloatingAssistant.capture_selection(owner)
            release_send.set()
            self.assertTrue(owner.selected_text_ready.done.wait(2))

        self.assertEqual(len(send_calls), 1)
        self.assertEqual(clipboard["value"], "user copied later")
        self.assertFalse(owner.capture_lock.locked())

    def test_capture_failure_releases_lock_and_restores_sentinel(self):
        owner = _CaptureOwner()
        clipboard = {"value": "old clipboard"}

        with patch.object(floating.pyperclip, "paste", side_effect=lambda: clipboard["value"]), \
                patch.object(floating.pyperclip, "copy", side_effect=lambda value: clipboard.update(value=value)), \
                patch.object(floating.keyboard, "send", side_effect=RuntimeError("copy failed")), \
                patch.object(floating.time, "sleep"):
            floating.FloatingAssistant.capture_selection(owner)
            self.assertTrue(owner.selected_text_ready.done.wait(2))

        self.assertEqual(owner.selected_text_ready.values, [""])
        self.assertEqual(clipboard["value"], "old clipboard")
        self.assertFalse(owner.capture_lock.locked())


class _HotkeyFilter:
    def __init__(self):
        self.registered = []

    def register(self, _hotkey):
        self.registered.append(_hotkey)


class FloatingAssistantUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.hotkey_filter = _HotkeyFilter()
        self.assistant = floating.FloatingAssistant(
            floating.copy.deepcopy(floating.DEFAULT_CONFIG), self.hotkey_filter
        )

    def tearDown(self):
        self.assistant.close()

    def test_window_is_resizable_and_result_renders_markdown(self):
        initial = self.assistant.size()
        self.assistant.resize(initial.width() + 80, initial.height() + 60)
        self.assertGreater(self.assistant.width(), initial.width())
        self.assertGreater(self.assistant.height(), initial.height())
        self.assertIsInstance(self.assistant.result_view, QTextBrowser)
        self.assertEqual(self.assistant.status_widget.maximumHeight(), 44)
        self.assertEqual(self.assistant.selection_badge.height(), 24)

        self.assistant.conversation = [{
            "role": "assistant",
            "content": "# 标题\n\n- 第一项\n- 第二项\n\n```python\nprint('ok')\n```",
        }]
        self.assistant.render_conversation()
        rendered = self.assistant.result_view.toHtml()
        self.assertIn("<h1", rendered)
        self.assertIn("<li", rendered)
        self.assertIn("print('ok')", rendered)

    def test_selection_popup_shrinks_to_visible_content(self):
        self.assistant.resize(560, 540)
        self.assistant.show_actions("短文本")
        self.app.processEvents()
        self.assertLess(self.assistant.height(), 540)
        self.assertGreaterEqual(self.assistant.height(), 220)

    def test_hosted_hotkey_can_be_updated_and_saved(self):
        with patch.object(floating, "save_config") as save_config:
            self.assistant.update_hotkey("Ctrl+Shift+X")

        self.assertEqual(self.assistant.config["hotkey"], "ctrl+shift+x")
        self.assertEqual(self.hotkey_filter.registered[-1], "ctrl+shift+x")
        save_config.assert_called_once_with(self.assistant.config)

    def test_followup_can_start_after_the_first_result(self):
        self.assertIsNone(self.assistant.worker)
        self.assistant.current_action = {"id": "summarize", "label": "总结", "user_request": "总结"}
        self.assistant.conversation = [{"role": "assistant", "content": "初次回答"}]
        self.assistant.followup_input.setPlainText("请继续说明")

        with patch.object(self.assistant, "run_workflow") as run_workflow:
            self.assistant.send_followup()

        self.assertTrue(self.assistant.followup_pending)
        self.assertEqual(self.assistant.conversation[-1], {"role": "user", "content": "请继续说明"})
        run_workflow.assert_called_once_with(self.assistant.current_action, "请继续说明")


class _Button:
    def __init__(self):
        self.enabled = None
        self.hidden = False

    def setEnabled(self, value):
        self.enabled = value

    def hide(self):
        self.hidden = True

    def show(self):
        self.hidden = False


class _Response:
    def __init__(self):
        self.closed = False

    def raise_for_status(self):
        return None

    def iter_lines(self, decode_unicode=True):
        return [
            'data: {"choices":[{"delta":{"content":"ok"}}]}',
            "data: [DONE]",
        ]

    def close(self):
        self.closed = True


class _WorkflowResponse(_Response):
    def iter_lines(self, decode_unicode=True):
        return ['data: {"event":"workflow_finished","data":{"outputs":{"answer":"ok"}}}']


class ChatWindowTests(unittest.TestCase):
    def test_chat_worker_closes_stream_response(self):
        response = _Response()
        worker = floating.ChatWorker(
            {"base_url": "https://example.test/v1", "api_key": "key", "model": "model", "verify_tls": True},
            [],
        )
        finished = []
        worker.finished.connect(finished.append)
        with patch.object(floating.requests, "post", return_value=response):
            worker.run()
        self.assertEqual(finished, ["ok"])
        self.assertTrue(response.closed)

    def test_stream_finishes_in_original_session_after_switch(self):
        original = {"id": "original", "messages": [{"role": "user", "content": "question"}]}
        current = {"id": "current", "messages": []}
        chat = floating.ChatWindow.__new__(floating.ChatWindow)
        chat.assistant = type("Assistant", (), {"config": {"chat_sessions": [original, current]}})()
        chat.current_session_id = "current"
        chat.worker_session_id = "original"
        chat.streaming_session_id = "original"
        chat.streaming_text = "partial"
        chat.save_sessions = Mock()
        chat.render_messages = Mock()
        chat.history = Mock()

        floating.ChatWindow.append_chunk(chat, " more")
        floating.ChatWindow.finish_message(chat, "answer")

        self.assertEqual(original["messages"][-1]["content"], "answer")
        self.assertEqual(current["messages"], [])
        self.assertEqual(chat.streaming_text, "")
        chat.render_messages.assert_not_called()

    def test_stop_button_is_reenabled_after_worker_finishes(self):
        worker = Mock()
        chat = floating.ChatWindow.__new__(floating.ChatWindow)
        chat.worker = worker
        chat.worker_thread = object()
        chat.worker_session_id = "session"
        chat.streaming_session_id = "session"
        chat.send_button = _Button()
        chat.stop_button = _Button()

        floating.ChatWindow.stop_generation(chat)
        self.assertTrue(worker.cancel.called)
        self.assertFalse(chat.stop_button.enabled)

        floating.ChatWindow.finish_thread(chat)
        self.assertTrue(chat.send_button.enabled)
        self.assertTrue(chat.stop_button.enabled)
        self.assertTrue(chat.stop_button.hidden)
        self.assertIsNone(chat.worker)
        self.assertIsNone(chat.worker_thread)


class WorkflowWorkerTests(unittest.TestCase):
    def test_workflow_worker_closes_workflow_response(self):
        response = _WorkflowResponse()
        worker = floating.WorkflowWorker(
            {
                "profiles": [{
                    "id": "workflow", "name": "workflow", "base_url": "https://example.test/v1",
                    "api_key": "key", "verify_tls": True, "mode": "workflow", "model": "",
                }],
                "active_profile_id": "workflow", "user": "test-user",
            },
            "原文", {"label": "总结", "user_request": "总结"},
        )
        finished = []
        worker.finished.connect(finished.append)
        with patch.object(floating.requests, "post", return_value=response):
            worker.run()
        self.assertEqual(finished, ["ok"])
        self.assertTrue(response.closed)

    def test_workflow_worker_closes_direct_llm_response(self):
        response = _Response()
        worker = floating.WorkflowWorker(
            {
                "profiles": [{
                    "id": "llm", "name": "llm", "base_url": "https://example.test/v1",
                    "api_key": "key", "verify_tls": True, "mode": "llm", "model": "model",
                }],
                "active_profile_id": "llm", "user": "test-user",
            },
            "原文", {"label": "总结", "user_request": "总结"},
        )
        finished = []
        worker.finished.connect(finished.append)
        with patch.object(floating.requests, "post", return_value=response):
            worker.run()
        self.assertEqual(finished, ["ok"])
        self.assertTrue(response.closed)


class HostedBridgeTests(unittest.TestCase):
    def test_hosted_run_action_includes_messages_and_stable_request_id(self):
        bridge = Mock()
        assistant = floating.FloatingAssistant.__new__(floating.FloatingAssistant)
        assistant.host_bridge = bridge
        assistant.selected_text = "原文"
        assistant.conversation = []
        assistant.current_action = None
        assistant.followup_pending = False
        assistant.current_request_id = None
        assistant.last_request_id = None
        assistant.chat_session_id = "chat-session-1"
        assistant.current_followup_text = ""
        assistant.streaming_result = ""
        assistant.result = ""
        assistant.hint = Mock()
        assistant.actions_layout = type("Layout", (), {"count": lambda self: 0})()
        assistant.stop_button = _Button()
        action = {"id": "summarize", "label": "总结", "user_request": "总结", "api_key": "secret"}

        floating.FloatingAssistant.run_workflow(assistant, action)

        event = bridge.send.call_args.args[0]
        self.assertEqual(event["event"], "runAction")
        self.assertEqual(event["requestId"], assistant.current_request_id)
        self.assertEqual(event["sessionId"], "chat-session-1")
        self.assertEqual(event["messages"][0]["role"], "system")
        self.assertNotIn("api_key", event["action"])

    def test_continue_in_chat_opens_the_persisted_session(self):
        bridge = Mock()
        assistant = floating.FloatingAssistant.__new__(floating.FloatingAssistant)
        assistant.host_bridge = bridge
        assistant.chat_session_id = "chat-session-1"
        assistant.current_request_id = None
        assistant.last_request_id = "request-1"
        assistant.current_followup_text = ""
        assistant.selected_text = "原文"
        assistant.current_action = {"label": "总结"}
        assistant.conversation = [{"role": "assistant", "content": "摘要"}]
        assistant.streaming_result = ""
        assistant.result = "摘要"
        assistant.hint = Mock()

        floating.FloatingAssistant.continue_in_chatbox(assistant)

        event = bridge.send.call_args.args[0]
        self.assertEqual(event["event"], "continueInChat")
        self.assertEqual(event["payload"]["sessionId"], "chat-session-1")

    def test_late_hosted_result_is_rejected(self):
        assistant = floating.FloatingAssistant.__new__(floating.FloatingAssistant)
        assistant.current_request_id = "active"
        self.assertTrue(assistant.request_matches("active"))
        self.assertFalse(assistant.request_matches("old"))

    def test_action_chunks_are_incremental_and_cancel_has_structured_payload(self):
        bridge = Mock()
        assistant = floating.FloatingAssistant.__new__(floating.FloatingAssistant)
        assistant.host_bridge = bridge
        assistant.current_request_id = "active"
        assistant.last_request_id = "active"
        assistant.chat_session_id = "chat-session-1"
        assistant.current_followup_text = "继续"
        assistant.selected_text = "原文"
        assistant.current_action = {"id": "reply", "label": "回复", "api_key": "hidden"}
        assistant.conversation = []
        assistant.streaming_result = ""
        assistant.result = ""
        assistant.selection_badge = Mock()
        assistant.result_view = Mock()
        assistant.render_conversation = Mock()
        assistant.ensure_result_room = Mock()
        assistant.stop_button = _Button()
        assistant.hint = Mock()

        self.assertTrue(assistant.append_action_chunk("第一段", "active"))
        self.assertFalse(assistant.append_action_chunk("迟到", "old"))
        floating.FloatingAssistant.cancel_action(assistant)

        self.assertEqual(assistant.streaming_result, "第一段")
        event = bridge.send.call_args.args[0]
        self.assertEqual(event["event"], "cancelAction")
        self.assertEqual(event["requestId"], "active")
        self.assertNotIn("api_key", event["payload"]["action"])


if __name__ == "__main__":
    unittest.main()
