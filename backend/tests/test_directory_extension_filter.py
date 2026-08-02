"""
Tests for the Directory Input node's file-type filter (config.extra["extensions"]).

The node-level "does DirectoryInput's execute() actually apply the filter" case
moved to tests/test_element_contract.py's
test_directory_input_applies_extension_filter; the raw file_service unit tests
below stay here since they cover parsing/matching edge cases (multi-extension
lists, separators, missing dot) that the contract test's minimal fixture
doesn't exercise.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import file_service  # noqa: E402


def _make_mixed_fixture_dir(tmp_path: Path) -> str:
    (tmp_path / "a.md").write_text("md a", encoding="utf-8")
    (tmp_path / "b.md").write_text("md b", encoding="utf-8")
    (tmp_path / "c.txt").write_text("txt c", encoding="utf-8")
    (tmp_path / "d.json").write_text("{}", encoding="utf-8")
    return str(tmp_path)


def test_parse_extensions_filter_variants():
    assert file_service.parse_extensions_filter("") is None
    assert file_service.parse_extensions_filter("   ") is None
    assert file_service.parse_extensions_filter(".md, txt") == [".md", "txt"]
    assert file_service.parse_extensions_filter(".md; .txt  .json") == [".md", ".txt", ".json"]


def test_list_directory_filters_by_extension(tmp_path):
    _make_mixed_fixture_dir(tmp_path)

    md_only = file_service.list_directory(str(tmp_path), extensions=[".md"])
    assert sorted(Path(p).name for p in md_only) == ["a.md", "b.md"]

    txt_without_dot = file_service.list_directory(str(tmp_path), extensions=["txt"])
    assert [Path(p).name for p in txt_without_dot] == ["c.txt"]

    unfiltered = file_service.list_directory(str(tmp_path), extensions=None)
    assert len(unfiltered) == 4

