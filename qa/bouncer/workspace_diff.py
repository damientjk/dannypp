"""Filesystem helpers for the real-Codex smoke cases (group 'real')."""

import hashlib
import importlib.util
import os
import sys

IGNORED_DIRS = {".codex", ".git", "node_modules", "dist", "__pycache__"}
IGNORED_FILES = {".env"}  # mirrors WorkspaceManager.create()'s .gitignore


def snapshot(dir_path):
    result = {}
    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        for name in files:
            if name in IGNORED_FILES or name.endswith(".log"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, dir_path)
            with open(full, "rb") as fh:
                result[rel] = hashlib.sha256(fh.read()).hexdigest()
    return result


def changed_files(before, after):
    changed = set()
    for rel, digest in after.items():
        if before.get(rel) != digest:
            changed.add(rel)
    for rel in before:
        if rel not in after:
            changed.add(rel)
    return changed


def load_module(path, module_name):
    # The demo repo's files import each other by bare name (calculator.py
    # does `from formatter import format_currency`). Loading calculator.py
    # from an arbitrary workspace path only resolves that import if the
    # workspace directory is on sys.path, and any previously loaded
    # `formatter` module must be evicted first -- otherwise a later case
    # loading a DIFFERENT workspace's calculator.py would silently reuse the
    # first workspace's cached formatter module.
    directory = os.path.dirname(path)
    sys.modules.pop("formatter", None)
    sys.modules.pop("calculator", None)
    sys.path.insert(0, directory)
    try:
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(directory)
