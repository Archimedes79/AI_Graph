"""
Tests for the Directory Input node's file-type filter (config.extra["extensions"]).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import (  # noqa: E402
    DataType,
    Graph,
    GraphMetadata,
    GraphNode,
    NodeConfig,
    NodeType,
    Port,
    PortKind,
)
from app.services import file_service  # noqa: E402
from app.services.graph_executor import execute_graph  # noqa: E402


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


@pytest.mark.asyncio
async def test_directory_input_node_applies_extension_filter(tmp_path):
    fixture_dir = _make_mixed_fixture_dir(tmp_path)

    graph = Graph(
        metadata=GraphMetadata(name="Directory Extension Filter"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.DIRECTORY_INPUT, label="Dir",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                    Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(value=fixture_dir, select_all_files=True, extra={"extensions": ".md"}),
            ),
        ],
        edges=[],
    )

    result = await execute_graph(graph)
    dir_result = next(r for r in result.node_results if r.node_id == "dir")
    assert dir_result.status == "success"
    files = sorted(Path(p).name for p in dir_result.outputs["files"])
    assert files == ["a.md", "b.md"]
    assert dir_result.outputs["count"] == 2
