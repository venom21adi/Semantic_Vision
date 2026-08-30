# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the bundled backend (Milestone 19, Part A).
#
# Freezes `run_backend.py` into a single-file `semantic-vision-backend[.exe]`
# with no user-side Python/`uv` dependency, for `vscode-extension`'s
# Marketplace build to spawn directly (see `backend.ts`'s
# `resolveBundledBackendPath`/`spawnBundledBackend`).
#
# Two extra collections were required beyond PyInstaller's default static
# analysis, both found by actually running the frozen binary rather than by
# reading the code -- exactly the kind of unknown this milestone's spike
# step existed to catch:
#
# - `collect_data_files('litellm')`: litellm reads its own bundled
#   `model_prices_and_context_window_backup.json` (and other data files)
#   via a plain file path relative to its package location at import time.
#   PyInstaller's static analysis only follows imports, not files opened at
#   runtime, so nothing copies this data file into the frozen bundle unless
#   told to -- without it, the frozen binary crashes on startup with
#   `FileNotFoundError` importing `litellm`.
# - `collect_submodules('tiktoken_ext')` plus an explicit hidden import of
#   `tiktoken_ext.openai_public`: litellm imports `tiktoken`, which
#   discovers its encoding constructors (`cl100k_base`, used to count
#   tokens for AI documentation) via `pkgutil`-based plugin discovery over
#   the `tiktoken_ext` namespace package -- dynamic enough that
#   PyInstaller's import-graph analysis can't see it either. Without it,
#   the frozen binary crashes on startup with
#   `ValueError: Unknown encoding cl100k_base`.
#
# Build from the repo root with:
#   uv run --with pyinstaller pyinstaller scripts/pyinstaller/backend.spec \
#     --distpath dist/pyinstaller --workpath build/pyinstaller
#
# Run the result with `--port <port>` (see `run_backend.py`), the same flag
# `backend.ts` already passes to the `uv run uvicorn ...` dev path.
#
# Spike validation performed for this milestone (Windows x64, manually):
# the frozen binary, launched with no Python or `uv` on PATH, answered
# `GET /api/health` and correctly parsed a real JS/TS fixture repo via
# `POST /api/parse-repo` (exercising the tree-sitter native extension) --
# the exact go/no-go bar `docs/PHASE-2-BUILD-PLAN.md` set for this spike.

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

datas = []
hiddenimports = ["tiktoken_ext.openai_public"]
datas += collect_data_files("litellm")
hiddenimports += collect_submodules("tiktoken_ext")


a = Analysis(
    ["run_backend.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="semantic-vision-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
