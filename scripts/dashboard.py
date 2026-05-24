#!/usr/bin/env python3
"""ENA World dashboard — vault sync and publish control panel."""

import os
import re
import subprocess

ANSI = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

from PyQt6.QtCore import QThread, QTimer, pyqtSignal
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import (
    QApplication, QHBoxLayout, QMainWindow,
    QPlainTextEdit, QPushButton, QVBoxLayout, QWidget,
)

PROJECT     = os.path.expanduser("~/Documents/ena-world")
VAULT       = os.path.expanduser("~/Documents/obsidian_vault")
IGNORE      = os.path.expanduser("~/.config/rclone/obsidian-ignore.txt")
PREVIEW_URL = "http://localhost:4321/ena-world/"

BISYNC_CMD = [
    "rclone", "bisync", VAULT, "google_drive:obsidian_vault",
    "--exclude-from", IGNORE, "--verbose",
]

BUILD_CMD = ["bash", "-c", "source ~/.nvm/nvm.sh && npm run build"]

PREVIEW = object()  # sentinel for the preview step

STEPS = [
    ("sync\nlocal ↔ drive", BISYNC_CMD),
    ("sync\nlocal → ENA",   [f"{PROJECT}/scripts/sync-vault.sh"]),
    ("preview\nlocal",      PREVIEW),
    ("publish\ngit push",   [
        "bash", "-c",
        f'cd "{PROJECT}" && '
        "git add src/content && "
        "{ [ -d public/attachments ] && git add public/attachments || true; } && "
        "git commit -m \"sync: obsidian vault $(date +'%Y-%m-%d %H:%M')\" || true && "
        "git push",
    ]),
]

RESYNC_CMD = BISYNC_CMD + ["--resync"]


class Worker(QThread):
    output = pyqtSignal(str)
    done   = pyqtSignal(int)

    def __init__(self, cmd):
        super().__init__()
        self.cmd = cmd

    def run(self):
        try:
            proc = subprocess.Popen(
                self.cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=PROJECT,
                text=True,
            )
            for line in proc.stdout:
                self.output.emit(ANSI.sub('', line))
            proc.wait()
            self.done.emit(proc.returncode)
        except Exception as e:
            self.output.emit(f"Error: {e}\n")
            self.done.emit(1)


class Dashboard(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ENA World")
        self.resize(700, 480)
        self._worker        = None
        self._preview_proc  = None
        self._after_success = None
        self._last_was_bisync = False
        self._build_ui()

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setSpacing(8)
        layout.setContentsMargins(12, 12, 12, 12)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(8)
        self._buttons = []
        for label, cmd in STEPS:
            b = QPushButton(label)
            b.setFixedHeight(56)
            b.setStyleSheet("font-size: 12px;")
            if cmd is PREVIEW:
                b.clicked.connect(self._do_preview)
            else:
                b.clicked.connect(lambda _, c=cmd: self._run(c, bisync=(c is BISYNC_CMD)))
            btn_row.addWidget(b)
            self._buttons.append(b)

        self._resync_btn = QPushButton("⚠ resync\n(recover)")
        self._resync_btn.setFixedHeight(56)
        self._resync_btn.setStyleSheet(
            "font-size: 12px; color: #fff; background: #b94a00;"
        )
        self._resync_btn.setVisible(False)
        self._resync_btn.clicked.connect(lambda: self._run(RESYNC_CMD, bisync=True))
        btn_row.addWidget(self._resync_btn)

        layout.addLayout(btn_row)

        self._log = QPlainTextEdit()
        self._log.setReadOnly(True)
        self._log.setFont(QFont("Monospace", 9))
        self._log.setStyleSheet("background:#1e1e1e; color:#d4d4d4; border:none;")
        layout.addWidget(self._log)

    def _do_preview(self):
        if self._preview_proc and self._preview_proc.poll() is None:
            self._preview_proc.terminate()
            self._preview_proc = None
        self._after_success = self._open_preview
        self._run(BUILD_CMD)

    def _open_preview(self):
        self._log.appendPlainText("Starting preview server...\n")
        self._preview_proc = subprocess.Popen(
            ["bash", "-c", "source ~/.nvm/nvm.sh && npm run preview"],
            cwd=PROJECT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._log.appendPlainText(f"Opening {PREVIEW_URL}\n")
        QTimer.singleShot(1500, lambda: subprocess.Popen(["xdg-open", PREVIEW_URL]))

    def _run(self, cmd, bisync=False):
        self._last_was_bisync = bisync
        self._resync_btn.setVisible(False)
        self._set_buttons(False)
        self._log.appendPlainText("─" * 60)
        self._worker = Worker(cmd)
        self._worker.output.connect(self._append)
        self._worker.done.connect(self._finished)
        self._worker.start()

    def _append(self, text):
        self._log.moveCursor(self._log.textCursor().MoveOperation.End)
        self._log.insertPlainText(text)
        self._log.ensureCursorVisible()

    def _finished(self, code):
        mark = "✓ done" if code == 0 else f"✗ exit {code}"
        self._log.appendPlainText(mark + "\n")
        self._resync_btn.setVisible(self._last_was_bisync and code != 0)
        if code == 0 and self._after_success:
            self._after_success()
        self._after_success = None
        self._set_buttons(True)

    def _set_buttons(self, enabled):
        for b in self._buttons:
            b.setEnabled(enabled)
        if self._resync_btn.isVisible():
            self._resync_btn.setEnabled(enabled)


    def closeEvent(self, event):
        if self._preview_proc and self._preview_proc.poll() is None:
            self._preview_proc.terminate()
        super().closeEvent(event)


if __name__ == "__main__":
    import sys
    app = QApplication(sys.argv)
    win = Dashboard()
    win.show()
    sys.exit(app.exec())
