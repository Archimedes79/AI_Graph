"""
Unit tests for app.services.file_service.detect_format.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import file_service  # noqa: E402


def test_detect_format_text_file(tmp_path):
    p = tmp_path / "notes.txt"
    p.write_text("just some plain text", encoding="utf-8")
    assert file_service.detect_format(str(p)) == "text"


def test_detect_format_json_file(tmp_path):
    p = tmp_path / "data.json"
    p.write_text(json.dumps({"a": 1}), encoding="utf-8")
    assert file_service.detect_format(str(p)) == "json"


def test_detect_format_csv_file(tmp_path):
    p = tmp_path / "table.csv"
    p.write_text("a,b\n1,2\n", encoding="utf-8")
    assert file_service.detect_format(str(p)) == "csv"


def test_detect_format_binary_file(tmp_path):
    p = tmp_path / "blob.bin"
    p.write_bytes(bytes(range(256)))
    assert file_service.detect_format(str(p)) == "binary"


def test_detect_format_missing_path_raises(tmp_path):
    missing = tmp_path / "does_not_exist.txt"
    with pytest.raises(FileNotFoundError):
        file_service.detect_format(str(missing))
