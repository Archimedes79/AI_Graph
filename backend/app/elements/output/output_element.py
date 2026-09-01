"""
The `output` node element: passthrough plus optional file/directory write, or
display in a text window (`write_mode == "window"`).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import file_service


class OutputElement(NodeElement):
    node_type = NodeType.OUTPUT
    config_fields = ("value", "prompt_at_runtime", "write_mode", "output_label")
