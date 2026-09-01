"""
The `output` node element: passthrough plus optional file/directory write, or
display in a text window (`write_mode == "window"`).
"""

from __future__ import annotations


from app.elements.base import NodeElement
from app.models.graph import NodeType


class OutputElement(NodeElement):
    node_type = NodeType.OUTPUT
    config_fields = ("value", "prompt_at_runtime", "write_mode", "output_label")
