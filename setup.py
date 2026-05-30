"""
AR Gesture Writing -- GUI Installer.

Bundled inside AR-Write-Setup.exe.  Shows a proper Windows installer wizard:
  - Welcome / notes
  - License agreement
  - Install path selection
  - Progress with file list
  - Completion with shortcut options

Only depends on stdlib (tkinter + zipfile) — no extra deps needed.
"""

import os
import shutil
import subprocess
import sys
import textwrap
import threading
import tkinter as tk
import zipfile
from tkinter import filedialog, messagebox, ttk

APP_NAME = "AR Gesture Writing"
APP_VERSION = "1.0.0"
DEFAULT_DIR = os.path.join(os.environ["LOCALAPPDATA"], "AR-Write")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_bundle_dir() -> str:
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _known_folder(name: str) -> str:
    """Resolve a Windows known-folder path via PowerShell."""
    ps = f"[Environment]::GetFolderPath('{name}')"
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=10,
        )
        return r.stdout.strip()
    except Exception:
        return ""


def _create_shortcut(target: str, link_path: str) -> None:
    ps = (
        f"$ws = New-Object -ComObject WScript.Shell;"
        f"$lnk = $ws.CreateShortcut('{link_path}');"
        f"$lnk.TargetPath = '{target}';"
        f"$lnk.WorkingDirectory = '{os.path.dirname(target)}';"
        f"$lnk.Description = '{APP_NAME}';"
        f"$lnk.Save()"
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, timeout=15,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Installer Wizard
# ---------------------------------------------------------------------------

class InstallerWizard:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title(f"{APP_NAME} v{APP_VERSION} 安装向导")
        self.root.geometry("580x440")
        self.root.resizable(False, False)
        # Center on screen
        self.root.update_idletasks()
        w, h = 580, 440
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        self.root.geometry(f"{w}x{h}+{(sw - w) // 2}+{(sh - h) // 2}")
        self.root.protocol("WM_DELETE_WINDOW", self._on_cancel)

        # State
        self.install_dir = tk.StringVar(value=DEFAULT_DIR)
        self.agreed = tk.BooleanVar(value=False)
        self.create_desktop = tk.BooleanVar(value=True)
        self.create_startmenu = tk.BooleanVar(value=True)
        self.launch_after = tk.BooleanVar(value=True)
        self._cancelled = False

        # Locate bundled zip
        self.zip_path = os.path.join(_get_bundle_dir(), "AR-Write.zip")

        # Build pages
        self._pages = []
        self._current_page = 0
        self._build_pages()

        self._show_page(0)
        self.root.mainloop()

    # ---- Pages ----------------------------------------------------------

    def _build_pages(self):
        self._pages = [
            self._page_welcome,
            self._page_license,
            self._page_path,
            self._page_progress,
            self._page_done,
        ]

    def _page_welcome(self, parent: ttk.Frame):
        ttk.Label(parent, text=APP_NAME, font=("Segoe UI", 18, "bold")).pack(pady=(30, 10))
        ttk.Label(parent, text=f"版本 {APP_VERSION}", font=("Segoe UI", 10)).pack()

        notes_frame = ttk.LabelFrame(parent, text="  注意事项  ", padding=15)
        notes_frame.pack(fill="x", padx=40, pady=20)

        notes = [
            "本应用需要摄像头才能正常使用。",
            "首次运行时，Windows 可能会弹出防火墙提示，请选择「允许」。",
            "请确保摄像头未被其他应用占用。",
            "安装只需要约 300 MB 磁盘空间。",
            "本软件仅供个人学习与研究使用。",
        ]
        for n in notes:
            ttk.Label(notes_frame, text=f"• {n}", wraplength=460).pack(anchor="w", pady=2)

        self._add_nav(parent, next_text="下一步 >")

    def _page_license(self, parent: ttk.Frame):
        ttk.Label(parent, text="许可协议", font=("Segoe UI", 14, "bold")).pack(pady=(25, 10))

        text = tk.Text(parent, width=58, height=12, wrap="word", relief="solid", borderwidth=1)
        license_text = textwrap.dedent("""\
        本软件（AR Gesture Writing）按"原样"提供，不作任何明示或默示的保证。

        您可以自由使用本软件用于个人学习与研究目的。
        您不得将本软件用于任何违法活动。
        您不得对本软件进行逆向工程、反编译或反汇编。

        作者不承担因使用本软件而产生的任何直接或间接损失的责任。

        本软件可能会收集匿名使用数据以改进用户体验。
        摄像头数据仅在本地处理，不会上传到任何服务器。

        点击"同意"即表示您已阅读并接受上述条款。
        """)
        text.insert("1.0", license_text)
        text.config(state="disabled")
        text.pack(fill="both", expand=True, padx=40, pady=5)

        ttk.Checkbutton(
            parent, text="我已阅读并同意上述条款", variable=self.agreed
        ).pack(pady=10)

        self._add_nav(parent, prev_text="< 上一步", next_text="同意并继续",
                      next_condition=lambda: self.agreed.get())

    def _page_path(self, parent: ttk.Frame):
        ttk.Label(parent, text="选择安装位置", font=("Segoe UI", 14, "bold")).pack(pady=(25, 15))

        path_frame = ttk.Frame(parent)
        path_frame.pack(fill="x", padx=40, pady=10)
        ttk.Label(path_frame, text="安装目录:").pack(anchor="w")
        entry_frame = ttk.Frame(path_frame)
        entry_frame.pack(fill="x", pady=5)
        ttk.Entry(entry_frame, textvariable=self.install_dir, width=42).pack(side="left", ipady=2)
        ttk.Button(entry_frame, text="浏览...", command=self._browse_dir).pack(side="left", padx=5)

        # Space info
        info_frame = ttk.LabelFrame(parent, text="  磁盘信息  ", padding=10)
        info_frame.pack(fill="x", padx=40, pady=15)

        self._space_label = ttk.Label(info_frame, text="正在计算...")
        self._space_label.pack(anchor="w")
        self.install_dir.trace_add("write", lambda *a: self._update_space())

        self._status_label = ttk.Label(parent, text="", foreground="red")
        self._status_label.pack()
        self._update_space()

        self._add_nav(parent, prev_text="< 上一步", next_text="安装",
                      next_condition=lambda: self._validate_path())

    def _page_progress(self, parent: ttk.Frame):
        self._progress_title = ttk.Label(parent, text="正在安装...", font=("Segoe UI", 14, "bold"))
        self._progress_title.pack(pady=(25, 15))

        self._progress_bar = ttk.Progressbar(parent, length=400, mode="determinate")
        self._progress_bar.pack(pady=10)

        self._progress_file = ttk.Label(parent, text="", wraplength=480)
        self._progress_file.pack(pady=5)

        self._progress_pct = ttk.Label(parent, text="0%")
        self._progress_pct.pack()

        ttk.Button(parent, text="取消安装", command=self._on_cancel).pack(pady=20)

    def _page_done(self, parent: ttk.Frame):
        ttk.Label(parent, text="✓ 安装完成！", font=("Segoe UI", 16, "bold"),
                  foreground="green").pack(pady=(30, 20))

        opts = ttk.LabelFrame(parent, text="  快捷选项  ", padding=15)
        opts.pack(fill="x", padx=60, pady=5)

        ttk.Checkbutton(opts, text="创建桌面快捷方式", variable=self.create_desktop).pack(anchor="w", pady=3)
        ttk.Checkbutton(opts, text="创建开始菜单快捷方式", variable=self.create_startmenu).pack(anchor="w", pady=3)
        ttk.Checkbutton(opts, text="立即启动应用", variable=self.launch_after).pack(anchor="w", pady=3)

        ttk.Button(parent, text="完成", command=self._on_finish).pack(pady=25)

    # ---- Navigation -----------------------------------------------------

    def _add_nav(self, parent, prev_text=None, next_text="下一步 >",
                 next_condition=None):
        nav = ttk.Frame(parent)
        nav.pack(side="bottom", fill="x", padx=30, pady=20)

        if prev_text:
            ttk.Button(nav, text=prev_text, command=self._go_prev).pack(side="left")
        ttk.Button(nav, text="取消", command=self._on_cancel).pack(side="right")
        if next_text:
            btn = ttk.Button(nav, text=next_text, command=self._go_next)
            btn.pack(side="right", padx=5)
            if next_condition:
                # Disable button until condition met
                def _check(*a):
                    btn.config(state="normal" if next_condition() else "disabled")
                next_condition_trace = next_condition
                # Re-check on any variable change by polling — simple approach
                self.root.after(100, lambda: self._poll_button(btn, next_condition))
                btn.config(state="normal" if next_condition() else "disabled")
            self._next_btn = btn

    def _poll_button(self, btn, condition):
        if self._current_page < len(self._pages):
            try:
                if condition():
                    btn.config(state="normal")
                else:
                    btn.config(state="disabled")
            except Exception:
                pass
            self.root.after(200, lambda: self._poll_button(btn, condition))

    def _show_page(self, index):
        for w in self.root.winfo_children():
            w.destroy()
        self._current_page = index
        page = ttk.Frame(self.root, padding=10)
        page.pack(fill="both", expand=True)
        self._pages[index](page)

    def _go_next(self):
        if self._current_page == 2:  # Path page → start install
            self._show_page(3)
            self._start_install()
        else:
            self._show_page(self._current_page + 1)

    def _go_prev(self):
        self._show_page(self._current_page - 1)

    def _on_cancel(self):
        if self._current_page == 3:
            self._cancelled = True
            return
        self.root.destroy()

    # ---- Path validation ------------------------------------------------

    def _browse_dir(self):
        d = filedialog.askdirectory(title="选择安装目录", initialdir=self.install_dir.get())
        if d:
            self.install_dir.set(os.path.join(d, "AR-Write"))

    def _update_space(self):
        d = self.install_dir.get()
        # Walk up to find existing parent
        parent = d
        while parent and not os.path.isdir(parent):
            parent = os.path.dirname(parent)
        if not parent:
            parent = "C:\\"
        try:
            usage = shutil.disk_usage(parent)
            free_gb = usage.free / (1024 ** 3)
            self._space_label.config(
                text=f"所需空间: ~300 MB    可用空间: {free_gb:.1f} GB"
            )
        except Exception:
            self._space_label.config(text="无法获取磁盘信息")

    def _validate_path(self) -> bool:
        d = self.install_dir.get().strip()
        if not d:
            self._status_label.config(text="请输入安装路径")
            return False
        # Check for problematic chars
        forbidden = '<>:"|?*'
        if any(c in d for c in forbidden):
            self._status_label.config(text="路径包含非法字符")
            return False
        # Check disk space (need ~300MB)
        parent = d
        while parent and not os.path.isdir(parent):
            parent = os.path.dirname(parent)
        if parent:
            try:
                free = shutil.disk_usage(parent).free
                if free < 300 * 1024 * 1024:
                    self._status_label.config(text=f"磁盘空间不足（需要 300 MB，仅剩 {free / 1024**2:.0f} MB）")
                    return False
            except Exception:
                pass
        self._status_label.config(text="")
        return True

    # ---- Installation ---------------------------------------------------

    def _start_install(self):
        target = self.install_dir.get()

        # Validate zip exists
        if not os.path.isfile(self.zip_path):
            self._progress_title.config(text="错误：安装包数据丢失")
            return

        # Remove old installation
        if os.path.isdir(target):
            try:
                shutil.rmtree(target)
            except Exception:
                self._progress_title.config(text="错误：无法删除旧版本，请检查是否正在运行")
                return

        os.makedirs(target, exist_ok=True)

        # Count files for progress
        with zipfile.ZipFile(self.zip_path, "r") as zf:
            self._total_files = len(zf.namelist())
            self._file_list = zf.namelist()

        self._progress_bar["maximum"] = self._total_files
        self._extracted = 0

        # Run extraction in thread
        t = threading.Thread(target=self._do_extract, args=(target,), daemon=True)
        t.start()

    def _do_extract(self, target: str):
        try:
            with zipfile.ZipFile(self.zip_path, "r") as zf:
                for i, name in enumerate(self._file_list):
                    if self._cancelled:
                        # Clean up partial install
                        try:
                            shutil.rmtree(target)
                        except Exception:
                            pass
                        self.root.after(0, self.root.destroy)
                        return
                    zf.extract(name, target)
                    self._extracted = i + 1
                    # Update UI every 5 files to avoid flooding
                    if i % 5 == 0 or i == self._total_files - 1:
                        self.root.after(0, self._update_progress, i + 1, name)
        except Exception as e:
            self.root.after(0, self._install_error, str(e))
            return

        self.root.after(0, self._install_done)

    def _update_progress(self, n: int, fname: str):
        self._progress_bar["value"] = n
        pct = n * 100 // self._total_files
        self._progress_pct.config(text=f"{pct}%")
        # Truncate long paths
        display = fname if len(fname) < 70 else "..." + fname[-67:]
        self._progress_file.config(text=f"正在解压: {display}")
        self.root.update_idletasks()

    def _install_error(self, msg: str):
        self._progress_title.config(text=f"安装失败", foreground="red")
        self._progress_file.config(text=msg)

    def _install_done(self):
        self._show_page(4)

    # ---- Finish ---------------------------------------------------------

    def _on_finish(self):
        exe = os.path.join(self.install_dir.get(), "AR-Write.exe")
        if not os.path.isfile(exe):
            messagebox.showerror("错误", f"找不到 {exe}")
            self.root.destroy()
            return

        # Create shortcuts
        if self.create_startmenu.get():
            programs = _known_folder("Programs")
            if programs:
                _create_shortcut(exe, os.path.join(programs, f"{APP_NAME}.lnk"))

        if self.create_desktop.get():
            desktop = _known_folder("Desktop")
            if desktop:
                _create_shortcut(exe, os.path.join(desktop, f"{APP_NAME}.lnk"))

        # Launch
        if self.launch_after.get():
            try:
                subprocess.Popen([exe])
            except Exception:
                pass

        self.root.destroy()


def main():
    if not os.path.isfile(os.path.join(_get_bundle_dir(), "AR-Write.zip")):
        # Running in dev without the zip — show error
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("安装包错误", "找不到 AR-Write.zip。\n请通过 build_exe.py 构建安装包。")
        root.destroy()
        sys.exit(1)

    InstallerWizard()


if __name__ == "__main__":
    main()
