"""
Graph DSL data models.

A Graph is a directed, acyclic (or cyclic-safe-execution) collection of Nodes
connected by Edges.  Each Node declares typed Ports (inputs / outputs).
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class NodeType(str, Enum):
    TEXT_INPUT = "text_input"
    FILE_INPUT = "file_input"
    IMAGE_INPUT = "image_input"
    DIRECTORY_INPUT = "directory_input"
    AI = "ai"
    CODE = "code"
    OUTPUT = "output"
    MERGE = "merge"
    SPLIT = "split"


class PortKind(str, Enum):
    INPUT = "input"
    OUTPUT = "output"


class DataType(str, Enum):
    TEXT = "text"
    FILE = "file"
    IMAGE = "image"
    LIST = "list"
    ANY = "any"


class AIProvider(str, Enum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


# ---------------------------------------------------------------------------
# Port & Node definitions
# ---------------------------------------------------------------------------

class Port(BaseModel):
    id: str
    name: str
    kind: PortKind
    data_type: DataType = DataType.ANY
    multi: bool = False          # True → accepts / produces multiple values
    required: bool = True
    description: str = ""


class NodePosition(BaseModel):
    x: float = 0.0
    y: float = 0.0


class NodeConfig(BaseModel):
    """Extra configuration that depends on node_type."""
    # text_input / file_input / image_input / directory_input
    value: Optional[str] = None           # literal value or path

    # ai node
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"
    system_prompt: str = ""
    temperature: float = 0.7

    # code node
    language: str = "python"             # python | javascript
    code: str = ""                       # generated / user-written code

    # output node
    output_label: str = "Result"

    # merge / split helpers
    separator: str = "\n"

    extra: Dict[str, Any] = Field(default_factory=dict)


class GraphNode(BaseModel):
    id: str
    node_type: NodeType
    label: str
    description: str = ""
    position: NodePosition = Field(default_factory=NodePosition)
    inputs: List[Port] = Field(default_factory=list)
    outputs: List[Port] = Field(default_factory=list)
    config: NodeConfig = Field(default_factory=NodeConfig)


class GraphEdge(BaseModel):
    id: str
    source_node_id: str
    source_port_id: str
    target_node_id: str
    target_port_id: str


class GraphMetadata(BaseModel):
    name: str = "Untitled Graph"
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    tags: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class Graph(BaseModel):
    """
    Top-level graph document – this is the Graph DSL schema.
    Serialised to / from JSON for storage, execution, and deployment.
    """
    metadata: GraphMetadata = Field(default_factory=GraphMetadata)
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Execution models
# ---------------------------------------------------------------------------

class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    SKIPPED = "skipped"


class NodeResult(BaseModel):
    node_id: str
    status: ExecutionStatus
    outputs: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    duration_ms: Optional[float] = None


class ExecutionResult(BaseModel):
    graph_id: Optional[str] = None
    status: ExecutionStatus
    node_results: List[NodeResult] = Field(default_factory=list)
    final_outputs: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    duration_ms: Optional[float] = None


# ---------------------------------------------------------------------------
# AI-generation request
# ---------------------------------------------------------------------------

class GenerateCodeRequest(BaseModel):
    description: str
    language: str = "python"
    context: str = ""
    inputs: List[str] = Field(default_factory=list)
    outputs: List[str] = Field(default_factory=list)
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"


class GenerateCodeResponse(BaseModel):
    code: str
    language: str
    explanation: str = ""


class GeneratePromptRequest(BaseModel):
    description: str
    context: str = ""
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"


class GeneratePromptResponse(BaseModel):
    system_prompt: str
    explanation: str = ""
