"""
One-click GitHub Release builder for AR-Write.

Builds a Windows GUI installer (.exe), creates a git tag, and publishes
a GitHub Release with the installer as a downloadable asset.

Prerequisites:
    pip install pyinstaller
    gh auth login          (GitHub CLI, one-time setup)
    cd backend && python convert_models.py   (ONNX models must exist)

Usage:
    python release.py                    # auto-version from date
    python release.py --version v1.2.0   # specify version tag
    python release.py --dry-run          # build installer only, skip release
"""

import argparse
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")


def check_prerequisites():
    """Verify everything needed is in place."""
    issues = []

    # gh CLI
    try:
        subprocess.run(["gh", "auth", "status"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        issues.append(
            "GitHub CLI (gh) not authenticated.  Run: gh auth login"
        )

    # PyInstaller
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        issues.append("PyInstaller not installed.  Run: pip install pyinstaller")

    # ONNX models (preferred; mediapipe still works but can't bundle)
    models_dir = os.path.join(BACKEND, ".models")
    det = os.path.join(models_dir, "hand_detector.onnx")
    ldm = os.path.join(models_dir, "hand_landmarks_detector.onnx")
    if not (os.path.isfile(det) and os.path.isfile(ldm)):
        print("WARNING: ONNX models not found. The exe will be built")
        print("  but users will need mediapipe installed to run it.")
        print("  Run 'cd backend && python convert_models.py' first for best results.")
        print()

    if issues:
        print("ERROR: Prerequisites not met:")
        for i in issues:
            print(f"  - {i}")
        sys.exit(1)


def build_exe():
    """Run the PyInstaller build (produces the GUI installer)."""
    print("=" * 54)
    print("  Step 1/4: Building AR-Write-Setup.exe ...")
    print("=" * 54)
    subprocess.run([sys.executable, os.path.join(ROOT, "build_exe.py")], check=True)
    exe_path = os.path.join(ROOT, "dist", "AR-Write-Setup.exe")
    if not os.path.isfile(exe_path):
        print("ERROR: Build failed -- AR-Write-Setup.exe not found.")
        sys.exit(1)
    size_mb = os.path.getsize(exe_path) / (1024 * 1024)
    print(f"  Built: {exe_path}  ({size_mb:.1f} MB)")
    print()
    return exe_path


def create_tag(version: str):
    """Create and push a git tag."""
    print("=" * 54)
    print(f"  Step 2/4: Creating tag {version} ...")
    print("=" * 54)

    # Check existing tag
    result = subprocess.run(
        ["git", "tag", "-l", version], capture_output=True, text=True
    )
    if result.stdout.strip():
        print(f"  Tag {version} already exists locally. Deleting ...")
        subprocess.run(["git", "tag", "-d", version], check=True)
        try:
            subprocess.run(["git", "push", "origin", f":refs/tags/{version}"], check=True)
        except subprocess.CalledProcessError:
            pass  # might not exist on remote

    subprocess.run(["git", "tag", "-a", version, "-m", f"Release {version}"], check=True)
    subprocess.run(["git", "push", "origin", version], check=True)
    print(f"  Tag {version} pushed.")
    print()


def create_release(version: str, exe_path: str):
    """Create a GitHub Release and upload the .exe."""
    print("=" * 54)
    print(f"  Step 3/4: Creating GitHub Release {version} ...")
    print("=" * 54)

    # Generate changelog from git log since last tag
    try:
        last_tag = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0", "HEAD^"],
            capture_output=True, text=True
        ).stdout.strip()
    except subprocess.CalledProcessError:
        last_tag = None

    if last_tag:
        log = subprocess.run(
            ["git", "log", f"{last_tag}..HEAD", "--oneline", "--no-merges"],
            capture_output=True, text=True
        ).stdout.strip()
        body = f"Changes since {last_tag}:\n\n{log}" if log else "No changes recorded."
    else:
        body = "Initial release of AR-Write."

    body += f"\n\n**Download**: `AR-Write-Setup.exe` (~{os.path.getsize(exe_path) / (1024 * 1024):.0f} MB, GUI installer — one-click setup, no Python required)."

    # Create release
    subprocess.run(
        [
            "gh", "release", "create", version,
            "--title", f"AR-Write {version}",
            "--notes", body,
            "--target", "dev",
        ],
        check=True,
    )

    # Upload asset
    print(f"  Uploading {os.path.basename(exe_path)} ...")
    subprocess.run(
        ["gh", "release", "upload", version, exe_path, "--clobber"],
        check=True,
    )
    print()


def print_summary(version: str):
    """Print final summary."""
    print("=" * 54)
    print("  Step 4/4: Done!")
    print("=" * 54)
    print(f"  Release:  https://github.com/TankidO-o/AR-Write/releases/tag/{version}")
    print(f"  Asset:    AR-Write-Setup.exe")
    print()
    print("  Users download and run AR-Write-Setup.exe —")
    print("  a guided GUI installer that sets up the app in one click.")
    print("  No Python, pip, or any dependencies required.")
    print("=" * 54)


def main():
    parser = argparse.ArgumentParser(description="Build and publish AR-Write release")
    parser.add_argument(
        "--version", default=None,
        help="Version tag (default: auto-generated from date, e.g. v2026.05.30)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Build exe only, skip tag + release"
    )
    args = parser.parse_args()

    # Version
    if args.version:
        version = args.version
    else:
        version = time.strftime("v%Y.%m.%d")

    check_prerequisites()
    exe_path = build_exe()

    if args.dry_run:
        print(f"Dry run complete. Exe: {exe_path}")
        return

    create_tag(version)
    create_release(version, exe_path)
    print_summary(version)


if __name__ == "__main__":
    main()
