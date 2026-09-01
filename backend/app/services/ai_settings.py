"""
Runtime AI configuration -- "configure the AI once, not once per node".

A node whose `ai_provider` is the `default` sentinel (the default for new AI
nodes) does not name a provider itself; it asks this module which provider and
model to use for *this run*. That is what lets one deployed graph be pointed at
a local LM Studio on one machine and at a hosted API on another without editing
the graph -- and what stops a graph with eight AI nodes from needing the same
provider typed in eight times.

Precedence, highest first:

  1. a run-level override      -- `--ai-provider/--ai-model` on the CLI, or the
                                  deployed GUI runtime's settings panel
  2. environment variables     -- AI_GRAPH_AI_PROVIDER / AI_GRAPH_AI_MODEL
  3. the settings file         -- ai-settings.json, see `settings_path()`
  4. the graph's own default   -- metadata.ai_defaults, set once in the editor
  5. the built-in fallback     -- ollama / llama3

A node that names a real provider keeps it: `default` means "follow the
runtime", an explicit provider means "always this one". Setting `force` (in the
settings file, `AI_GRAPH_AI_FORCE=1`, or `--ai-force`) overrides even those, for
the case where a deployed tool must run entirely against one endpoint.

Provider endpoints and API keys follow the same idea: an explicitly set
environment variable always wins, otherwise the settings file supplies them, so
a double-clicked executable can be configured without setting env vars at all.

This module is part of the portable engine and is vendored verbatim into every
deploy bundle -- editor, CLI and deployed tool resolve the AI identically.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# The value a node's `ai_provider` carries when it has no opinion of its own.
DEFAULT_SENTINEL = "default"

FALLBACK_PROVIDER = "ollama"

# The model to call when a provider was chosen but no model was named.
#
# This is per provider on purpose: there used to be one global fallback
# ("llama3", an ollama tag), which meant picking Google or OpenAI in the
# dropdown without also typing a model asked *that* provider for a model named
# `llama3` -- and a hosted provider answers an unknown model with a bare
# `404 Not Found`, which reads like the endpoint is wrong rather than the model.
# `openai_compatible` is deliberately absent: its endpoint is whatever the user
# pointed it at, so there is no model anyone could guess for it.
#
# Google gets a `-latest` alias rather than a pinned version on purpose: Google
# retires numbered Gemini releases for new users ("this model is no longer
# available to new users"), so a pinned default rots into a 404 for exactly the
# newcomers a default exists to serve.
DEFAULT_MODELS = {
    "ollama": "llama3",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-opus-5",
    "google": "gemini-flash-lite-latest",
    "github_copilot": "gpt-4o-mini",
}

# Kept as the last resort for the built-in default provider (ollama).
FALLBACK_MODEL = DEFAULT_MODELS["ollama"]

SETTINGS_FILENAME = "ai-settings.json"

# Set by execute_graph() from the graph's metadata.ai_defaults at the start of
# every run (priority 4), and by the CLI/GUI runtime as a run-level override
# (priority 1). Module-level because the element that needs it -- the ai node --
# deliberately never sees the graph it lives in.
_graph_defaults: Tuple[str, str] = ("", "")
_override: Tuple[str, str] = ("", "")
_override_force: bool = False

_cached_settings: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# The settings file
# ---------------------------------------------------------------------------

def candidate_paths() -> list[Path]:
    """
    Where `ai-settings.json` is looked for, in order. The executable's own
    directory is included so a shipped one-file build can be configured by
    dropping a settings file next to it -- the deployed equivalent of an
    application's config file.
    """
    explicit = os.getenv("AI_GRAPH_SETTINGS", "")
    if explicit:
        # The only candidate, not the first of several: "use this file" has to
        # hold when the file is not there yet, or the search falls through to
        # whatever else happens to sit on this machine. `settings_path()` below
        # already says this for writing; reading was still falling through.
        return [Path(explicit).expanduser()]
    paths: list[Path] = []
    paths.append(Path.cwd() / SETTINGS_FILENAME)
    if getattr(sys, "frozen", False) or getattr(sys, "_MEIPASS", None):
        paths.append(Path(sys.executable).parent / SETTINGS_FILENAME)
    else:
        paths.append(Path(sys.argv[0]).resolve().parent / SETTINGS_FILENAME)
    paths.append(Path.home() / ".ai-graph" / "settings.json")
    # Preserve order while dropping duplicates (cwd often == script dir).
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        key = str(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def settings_path() -> Path:
    """
    The settings file in use.

    An explicitly configured `AI_GRAPH_SETTINGS` wins outright, whether or not
    the file exists yet: "use this file" has to hold for the first write too,
    or `save()` silently lands somewhere else. It did -- pointing the variable
    at a not-yet-created file fell through to the first *existing* candidate,
    so the test suite wrote its fixtures into the developer's own
    ai-settings.json instead of its tmp_path.

    Otherwise: the first candidate that exists, else the first candidate, which
    is where `save()` will create it.
    """
    explicit = os.getenv("AI_GRAPH_SETTINGS", "")
    if explicit:
        return Path(explicit).expanduser()
    candidates = candidate_paths()
    for path in candidates:
        if path.is_file():
            return path
    return candidates[0]


def settings() -> Dict[str, Any]:
    """The parsed settings file, or an empty dict. Cached; a malformed file is
    logged once and treated as absent rather than breaking the run."""
    global _cached_settings
    if _cached_settings is None:
        _cached_settings = {}
        for path in candidate_paths():
            if not path.is_file():
                continue
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Ignoring unreadable AI settings file %s: %s", path, exc)
                continue
            if isinstance(loaded, dict):
                _cached_settings = loaded
            break
    return _cached_settings


def reset_cache() -> None:
    """Forget the parsed settings file and any local-provider probe results
    (after `save()`, or in tests)."""
    global _cached_settings
    _cached_settings = None
    _probe_cache.clear()


def save(new_settings: Dict[str, Any], path: Optional[Path] = None) -> Path:
    """Write the settings file and drop the cache. Used by the deployed GUI
    runtime's settings panel so a non-technical user can point the tool at a
    different AI without touching a JSON file or an environment variable."""
    target = Path(path) if path else settings_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(new_settings, indent=2) + "\n", encoding="utf-8")
    reset_cache()
    return target


def _section(name: str) -> Dict[str, Any]:
    value = settings().get(name)
    return value if isinstance(value, dict) else {}


# ---------------------------------------------------------------------------
# Local provider discovery
# ---------------------------------------------------------------------------
#
# "Configure the AI once" only helps if there is something sensible when the
# user configured *nothing*: a static ollama/llama3 fallback means a machine
# that runs LM Studio instead (or ollama under a different model name) gets
# connection errors out of the box. So the bottom rung of the precedence
# ladder asks the local providers themselves: a quick HTTP probe (stdlib
# urllib -- this module must stay dependency-free for deploy bundles), cached
# per process. Explicit configuration at any higher rung bypasses all of this.

LOCAL_PROVIDERS = ("ollama", "lmstudio")

_probe_cache: Dict[str, Optional[list]] = {}


def _local_base_url(provider: str) -> str:
    # Defaults mirror ai_service's module-level constants; resolved through
    # the same env-var/settings-file precedence via endpoint().
    if provider == "ollama":
        return endpoint("OLLAMA_BASE_URL", os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"), "ollama_base_url")
    return endpoint("LMSTUDIO_BASE_URL", os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"), "lmstudio_base_url")


def probe_local_models(provider: str, timeout: float = 1.5, refresh: bool = False) -> Optional[list]:
    """
    The model names a local provider currently serves, or None if it isn't
    reachable. Cached per process; pass refresh=True to re-probe (the editor's
    provider-status endpoint does, so starting LM Studio mid-session is
    picked up).
    """
    if provider not in LOCAL_PROVIDERS:
        return None
    if not refresh and provider in _probe_cache:
        return _probe_cache[provider]

    import urllib.request

    url = _local_base_url(provider).rstrip("/") + ("/api/tags" if provider == "ollama" else "/models")
    models: Optional[list] = None
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if provider == "ollama":
            models = [m.get("name", "") for m in payload.get("models", []) if m.get("name")]
        else:
            models = [m.get("id", "") for m in payload.get("data", []) if m.get("id")]
    except Exception as exc:  # noqa: BLE001 -- unreachable is a normal answer here
        logger.debug("Local AI provider %s not reachable at %s: %s", provider, url, exc)
    _probe_cache[provider] = models
    return models


def _first_reachable_local_provider() -> str:
    for provider in LOCAL_PROVIDERS:
        if probe_local_models(provider):
            return provider
    return ""


def _default_model_for(provider: str) -> str:
    """
    A usable model when none was configured.

    For a local provider that is running, the first model it actually serves --
    an LM Studio model id or an installed ollama tag beats any guess. Otherwise
    that provider's own documented default (`DEFAULT_MODELS`), which is empty
    for `openai_compatible`, where only the user knows what their endpoint
    serves.
    """
    models = probe_local_models(provider)
    if models:
        return models[0]
    return DEFAULT_MODELS.get(provider, "")


# ---------------------------------------------------------------------------
# Run-level state
# ---------------------------------------------------------------------------

def set_graph_defaults(provider: str = "", model: str = "") -> None:
    """Record the graph's own default (metadata.ai_defaults). Called by
    execute_graph() at the start of every run."""
    global _graph_defaults
    _graph_defaults = (provider or "", model or "")


def set_override(provider: str = "", model: str = "", force: bool = False) -> None:
    """Record a run-level override -- CLI flags, or the deployed runtime's
    settings panel for the current process."""
    global _override, _override_force
    _override = (provider or "", model or "")
    _override_force = bool(force)


def _forced() -> bool:
    if _override_force:
        return True
    if os.getenv("AI_GRAPH_AI_FORCE", "").strip().lower() in ("1", "true", "yes"):
        return True
    return bool(_section("ai").get("force"))


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def _runtime_target() -> Tuple[str, str]:
    """The provider/model this run should use for nodes that have no opinion,
    walking the precedence list above."""
    ai_section = _section("ai")
    provider = (
        _override[0]
        or os.getenv("AI_GRAPH_AI_PROVIDER", "")
        or str(ai_section.get("provider") or "")
        or _graph_defaults[0]
    )
    model = (
        _override[1]
        or os.getenv("AI_GRAPH_AI_MODEL", "")
        or str(ai_section.get("model") or "")
        or _graph_defaults[1]
    )
    if not provider:
        # Nothing configured anywhere: use whichever local provider is
        # actually running (see "Local provider discovery" above) before
        # falling back to the static default.
        provider = _first_reachable_local_provider() or FALLBACK_PROVIDER
    if not model:
        model = _default_model_for(provider)
    return provider, model


def resolve_target(provider: str, model: str) -> Tuple[str, str]:
    """
    Turn one node's configured (provider, model) into what should actually be
    called. A node that names a provider keeps it unless `force` is set; the
    `default` sentinel (and an empty provider, for graphs written before the
    sentinel existed) follows the runtime configuration.

    Model and provider resolve independently, so a node may pin the provider
    and still leave the model to the runtime.
    """
    runtime_provider, runtime_model = _runtime_target()
    if _forced():
        return runtime_provider, runtime_model
    resolved_provider = provider if provider and provider != DEFAULT_SENTINEL else runtime_provider
    resolved_model = model or (runtime_model if resolved_provider == runtime_provider else "")
    # A node that pins a provider but not a model gets that provider's own
    # default -- a running local provider's first served model, else the entry
    # in DEFAULT_MODELS. Only `openai_compatible` can come back empty; the
    # caller turns that into "name a model" rather than sending "" to an
    # endpoint that would answer with something unhelpful.
    return resolved_provider, resolved_model or _default_model_for(resolved_provider)


def resolve_gen_target(provider: str, model: str) -> Tuple[str, str]:
    """
    The design-time counterpart of `resolve_target`: which AI writes code and
    system prompts. Kept separate on purpose -- generation benefits from a
    stronger model than the cheap/local one a graph may run its inference on.

    The editor sends its one configured generation AI with every request, so
    this only fills in the blanks: AI_GRAPH_GEN_PROVIDER / AI_GRAPH_GEN_MODEL,
    then the settings file's "codegen" section, then the runtime target.
    """
    codegen = _section("codegen")
    resolved_provider = (
        (provider if provider and provider != DEFAULT_SENTINEL else "")
        or os.getenv("AI_GRAPH_GEN_PROVIDER", "")
        or str(codegen.get("provider") or "")
    )
    resolved_model = model or os.getenv("AI_GRAPH_GEN_MODEL", "") or str(codegen.get("model") or "")
    if resolved_provider and resolved_model:
        return resolved_provider, resolved_model
    fallback_provider, fallback_model = _runtime_target()
    return resolved_provider or fallback_provider, resolved_model or fallback_model


def describe() -> Dict[str, Any]:
    """The effective configuration, for the CLI banner and the runtime settings
    panel -- so a user can see what the tool will actually call before running."""
    provider, model = _runtime_target()
    return {
        "provider": provider,
        "model": model,
        "force": _forced(),
        "settings_file": str(settings_path()),
        "settings_file_exists": settings_path().is_file(),
        "graph_default_provider": _graph_defaults[0],
        "graph_default_model": _graph_defaults[1],
    }


# ---------------------------------------------------------------------------
# Endpoints and credentials
# ---------------------------------------------------------------------------

def _env_or_settings(env_name: str, env_value: str, settings_section: str, settings_key: str) -> str:
    """
    An explicitly-set environment variable always wins; otherwise the settings
    file supplies the value, falling back to *env_value* (which carries the
    module-level default when the variable was never set).
    """
    if os.getenv(env_name):
        return env_value
    from_settings = _section(settings_section).get(settings_key)
    return str(from_settings) if from_settings else env_value


def endpoint(env_name: str, env_value: str, settings_key: str) -> str:
    """Resolve a provider base URL (see ai_service's provider helpers)."""
    return _env_or_settings(env_name, env_value, "endpoints", settings_key)


def credential(env_name: str, env_value: str, settings_key: str) -> str:
    """Resolve a provider API key/token."""
    return _env_or_settings(env_name, env_value, "api_keys", settings_key)


def example_settings() -> Dict[str, Any]:
    """A fully-populated example, written into every deploy bundle's README so
    the shape of the file is documented where it is actually needed."""
    return {
        "ai": {"provider": "lmstudio", "model": "qwen2.5-coder-7b", "force": False},
        "codegen": {"provider": "anthropic", "model": "claude-3-5-sonnet-latest"},
        "endpoints": {
            "ollama_base_url": "http://localhost:11434",
            "lmstudio_base_url": "http://localhost:1234/v1",
            "openai_compatible_base_url": "https://my-endpoint.example.com/v1",
        },
        "api_keys": {
            "openai": "",
            "anthropic": "",
            "openai_compatible": "",
            "google": "",
            "github": "",
        },
    }
