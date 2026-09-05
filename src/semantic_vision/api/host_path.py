"""Translates a host-machine path into its in-container mount point.

`docker-compose.yml` mounts `REPO_PATH` (a path on the user's own
machine) read-only at the fixed in-container path `/workspace/repo`. The
backend process only ever sees the container's filesystem, so a raw host
path typed into the app -- `C:\\Users\\you\\projects\\my-api`, say --
never resolves to anything real from inside the container, even though
it's the most natural thing for a person to paste.

`docker-compose.yml` also passes that same `REPO_PATH` value through as
`SEMANTIC_VISION_HOST_REPO_PATH`, purely so this module can recognize a
pasted host path that falls under it and rewrite it to the matching
`/workspace/repo/...` path -- e.g. `REPO_PATH=C:/Users/you/projects` (the
guides/docker-setup.md "mount the parent folder" pattern) lets
`C:\\Users\\you\\projects\\my-api` and `/workspace/repo/my-api` resolve to
the exact same place. Outside Docker, `SEMANTIC_VISION_HOST_REPO_PATH` is
never set, so `translate_host_path` is a no-op and every path is used
exactly as typed, unchanged from before this existed.
"""

from __future__ import annotations

import os

HOST_REPO_PATH_ENV = "SEMANTIC_VISION_HOST_REPO_PATH"
CONTAINER_REPO_ROOT = "/workspace/repo"


def _with_forward_slashes(path: str) -> str:
    """Backslash-to-forward-slash, trailing slash stripped -- the one
    normalized form used for both comparing and slicing below, so the
    two never drift out of sync with each other."""
    return path.replace("\\", "/").rstrip("/")


def translate_host_path(raw_path: str) -> str:
    """Rewrites `raw_path` to its `/workspace/repo`-relative form if it
    falls under the configured host repo path; returns it unchanged
    otherwise (including when no host repo path is configured at all --
    the native, non-Docker case)."""
    host_repo_path = os.environ.get(HOST_REPO_PATH_ENV, "")
    if not host_repo_path:
        return raw_path

    host_normalized = _with_forward_slashes(host_repo_path)
    raw_normalized = _with_forward_slashes(raw_path)

    # Case-insensitive comparison only -- Windows paths vary in case
    # depending on how a shell or file manager happened to type them
    # out, and a false-positive match here just lands on a path that
    # differs only in case, which is still a reasonable place to land.
    if raw_normalized.lower() == host_normalized.lower():
        return CONTAINER_REPO_ROOT

    prefix = host_normalized.lower() + "/"
    if not raw_normalized.lower().startswith(prefix):
        return raw_path

    # Slice the real-cased `raw_normalized` (not the lowercased copy) by
    # the matched prefix's length -- both strings share the same forward
    # slashes and stripped trailing slash, so the length lines up exactly
    # with where the host repo path ends and the subfolder begins.
    suffix = raw_normalized[len(host_normalized):]
    return CONTAINER_REPO_ROOT + suffix
