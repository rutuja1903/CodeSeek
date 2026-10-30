"""
history.py -- CodeSeek File Version History

File-based snapshot store for edited Python files. Snapshots live outside every
project source directory, so the scanner never indexes them, and they are keyed
by (project_id, relative_path) -- never by file id, because re-indexing rebuilds
file rows and assigns new ids.

Layout:
    <history_root>/<project_id>/<sha256(relative_path)>/<version_id>.snapshot
    <history_root>/<project_id>/<sha256(relative_path)>/<version_id>.json

Every path component is an integer, a hex digest, or a generated version id, so
user-supplied relative paths are never used to build filesystem paths.
Snapshot bytes are stored exactly as they were on disk (encoding, BOM and line
endings untouched).
"""

import os
import re
import json
import time
import uuid
import codecs
import hashlib
from datetime import datetime, timezone

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# CODESEEK_HISTORY_DIR lets tests (or deployments) point the store elsewhere
HISTORY_ROOT = os.environ.get("CODESEEK_HISTORY_DIR") or os.path.join(_BACKEND_DIR, "version_history")

MAX_VERSIONS_PER_FILE = 10

# <16-digit microsecond timestamp>-<12 hex chars>; sorts chronologically as a string
_VERSION_ID_RE = re.compile(r"^\d{16}-[0-9a-f]{12}$")


class InvalidVersionId(ValueError):
    pass


class VersionNotFound(LookupError):
    pass


class SnapshotCorrupted(Exception):
    pass


def is_valid_version_id(version_id) -> bool:
    return isinstance(version_id, str) and _VERSION_ID_RE.fullmatch(version_id) is not None


def _file_dir(project_id: int, relative_path: str) -> str:
    key = hashlib.sha256(relative_path.encode("utf-8")).hexdigest()
    return os.path.join(HISTORY_ROOT, str(int(project_id)), key)


def atomic_write_bytes(target_path: str, data: bytes) -> None:
    """
    Write bytes to target_path atomically (temp file in the same directory,
    fsync, os.replace). The target is either fully replaced or left untouched.
    """
    target_dir = os.path.dirname(target_path)
    temp_path = os.path.join(target_dir, f".{os.path.basename(target_path)}.{uuid.uuid4().hex}.tmp")
    try:
        with open(temp_path, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, target_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _count_lines(text: str) -> int:
    # Same rule as parser.py so history line counts match the indexed files
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def decode_for_display(data: bytes) -> dict:
    """
    Decode snapshot bytes for preview only. Restoration always uses the raw bytes.
    Newlines are normalised like Python's text-mode read, matching the indexed source.
    """
    try:
        text = data.decode("utf-8-sig")
        decode_errors = False
    except UnicodeDecodeError:
        text = data.decode("utf-8-sig", errors="replace")
        decode_errors = True

    if b"\r\n" in data:
        line_endings = "crlf" if b"\n" not in data.replace(b"\r\n", b"") else "mixed"
    else:
        line_endings = "lf"

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return {
        "source": text,
        "has_bom": data.startswith(codecs.BOM_UTF8),
        "line_endings": line_endings,
        "decode_errors": decode_errors,
        "line_count": _count_lines(text),
    }


def _read_meta(directory: str, version_id: str, project_id: int, relative_path: str):
    """Load and sanity-check a version's metadata; returns None if missing or inconsistent."""
    meta_path = os.path.join(directory, f"{version_id}.json")
    snapshot_path = os.path.join(directory, f"{version_id}.snapshot")
    if not os.path.isfile(meta_path) or not os.path.isfile(snapshot_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        return None
    if (
        not isinstance(meta, dict)
        or meta.get("version_id") != version_id
        or meta.get("project_id") != project_id
        or meta.get("relative_path") != relative_path
    ):
        return None
    return meta


def list_versions(project_id: int, relative_path: str) -> list:
    """Return metadata for all versions of a file, newest first."""
    directory = _file_dir(project_id, relative_path)
    if not os.path.isdir(directory):
        return []

    versions = []
    for name in os.listdir(directory):
        if not name.endswith(".json"):
            continue
        version_id = name[: -len(".json")]
        if not is_valid_version_id(version_id):
            continue
        meta = _read_meta(directory, version_id, project_id, relative_path)
        if meta is not None:
            versions.append(meta)

    versions.sort(key=lambda m: m["version_id"], reverse=True)
    return versions


def get_version(project_id: int, relative_path: str, version_id: str):
    """
    Return (metadata, raw_bytes) for one version of this project's file.
    Raises InvalidVersionId, VersionNotFound, or SnapshotCorrupted.
    """
    if not is_valid_version_id(version_id):
        raise InvalidVersionId(version_id)

    directory = _file_dir(project_id, relative_path)
    meta = _read_meta(directory, version_id, project_id, relative_path)
    if meta is None:
        raise VersionNotFound(version_id)

    with open(os.path.join(directory, f"{version_id}.snapshot"), "rb") as f:
        data = f.read()

    if len(data) != meta.get("size") or hashlib.sha256(data).hexdigest() != meta.get("sha256"):
        raise SnapshotCorrupted(version_id)
    return meta, data


def _new_version_id(latest_versions: list) -> str:
    now_us = time.time_ns() // 1000
    # Keep ids strictly increasing even when the clock is coarse or goes backwards
    if latest_versions:
        latest_us = int(latest_versions[0]["version_id"].split("-")[0])
        now_us = max(now_us, latest_us + 1)
    return f"{now_us:016d}-{uuid.uuid4().hex[:12]}"


def create_snapshot(project_id: int, relative_path: str, data: bytes, reason: str) -> dict:
    """
    Store data as a new version of the file and prune old versions.
    If data is identical to the newest version, that version is returned instead
    of storing a duplicate.
    """
    directory = _file_dir(project_id, relative_path)
    os.makedirs(directory, exist_ok=True)

    digest = hashlib.sha256(data).hexdigest()
    existing = list_versions(project_id, relative_path)
    if existing and existing[0]["sha256"] == digest:
        return existing[0]

    version_id = _new_version_id(existing)
    created_us = int(version_id.split("-")[0])
    display = decode_for_display(data)
    meta = {
        "version_id": version_id,
        "project_id": int(project_id),
        "relative_path": relative_path,
        "created_at": datetime.fromtimestamp(created_us / 1_000_000, tz=timezone.utc).isoformat(timespec="milliseconds"),
        "reason": reason,
        "size": len(data),
        "sha256": digest,
        "line_count": display["line_count"],
    }

    # Snapshot first, metadata last: a version only becomes visible once both exist
    atomic_write_bytes(os.path.join(directory, f"{version_id}.snapshot"), data)
    atomic_write_bytes(os.path.join(directory, f"{version_id}.json"), json.dumps(meta, indent=2).encode("utf-8"))

    prune_versions(project_id, relative_path)
    return meta


def prune_versions(project_id: int, relative_path: str, keep: int = MAX_VERSIONS_PER_FILE) -> list:
    """
    Delete versions beyond the newest `keep`. Only touches snapshot/metadata
    files inside this file's history directory. Returns removed version ids.
    """
    directory = _file_dir(project_id, relative_path)
    removed = []
    for meta in list_versions(project_id, relative_path)[keep:]:
        version_id = meta["version_id"]
        for suffix in (".json", ".snapshot"):
            try:
                os.remove(os.path.join(directory, f"{version_id}{suffix}"))
            except FileNotFoundError:
                pass
        removed.append(version_id)
    return removed
