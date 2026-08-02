"""
Unit tests for app.services.file_service format-aware writing helpers:
serialize_text_value, write_formatted_file, and write_output_directory.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import file_service  # noqa: E402


def test_serialize_text_value_json():
    ext, content = file_service.serialize_text_value({"a": 1}, "json")
    assert ext == ".json"
    assert json.loads(content) == {"a": 1}


def test_serialize_text_value_csv():
    ext, content = file_service.serialize_text_value(
        [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}], "csv"
    )
    assert ext == ".csv"
    assert "a,b" in content
    assert "1,2" in content


def test_serialize_text_value_defaults_to_text():
    ext, content = file_service.serialize_text_value(42, None)
    assert ext == ".txt"
    assert content == "42"


def test_write_formatted_file_json(tmp_path):
    out_path = tmp_path / "result"
    written = file_service.write_formatted_file(str(out_path), [1, 2, 3], "json")
    assert written.endswith(".json")
    assert json.loads(Path(written).read_text(encoding="utf-8")) == [1, 2, 3]


def test_write_formatted_file_csv(tmp_path):
    out_path = tmp_path / "result.txt"
    written = file_service.write_formatted_file(
        str(out_path), [{"x": "1"}, {"x": "2"}], "csv"
    )
    assert written.endswith(".csv")
    content = Path(written).read_text(encoding="utf-8")
    assert "x" in content and "1" in content and "2" in content


def test_write_formatted_file_binary(tmp_path):
    raw = b"\x00\x01\x02binarydata"
    encoded = base64.b64encode(raw).decode("ascii")
    out_path = tmp_path / "blob"
    written = file_service.write_formatted_file(str(out_path), encoded, "binary")
    assert written.endswith(".bin")
    assert Path(written).read_bytes() == raw


def test_write_formatted_file_image_extension(tmp_path):
    raw = b"\x89PNG\r\n\x1a\nfakepngdata"
    encoded = base64.b64encode(raw).decode("ascii")
    out_path = tmp_path / "picture"
    written = file_service.write_formatted_file(str(out_path), encoded, "image/png")
    assert written.endswith(".png")
    assert Path(written).read_bytes() == raw


def test_write_output_directory_mixed_formats(tmp_path):
    written = file_service.write_output_directory(
        str(tmp_path),
        {"data": {"a": 1}, "note": "plain text"},
        {"data": "json", "note": None},
    )
    json_path = next(p for p in written if Path(p).suffix == ".json")
    text_path = next(p for p in written if Path(p).suffix == ".txt")
    assert Path(json_path).stem.startswith("data")
    assert Path(text_path).stem.startswith("note")
    assert json.loads(Path(json_path).read_text(encoding="utf-8")) == {"a": 1}
