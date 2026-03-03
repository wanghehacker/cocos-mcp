import json
import logging
import socket
import threading
import time
from typing import Any, Dict, Optional

from mcp.server.fastmcp import FastMCP

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cocos-mcp")


class CocosSocketClient:
    """TCP client that talks to the Cocos Creator editor extension."""

    def __init__(
        self,
        host: str,
        port: int,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ) -> None:
        self.host = host
        self.port = port
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._sock: Optional[socket.socket] = None
        self._lock = threading.Lock()
        self._next_id = 1

    def _connect(self) -> None:
        if self._sock:
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10.0)
        sock.connect((self.host, self.port))
        self._sock = sock
        logger.info("Connected to Cocos Creator at %s:%s", self.host, self.port)

    def _disconnect(self) -> None:
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None

    def _send(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._connect()
        assert self._sock is not None
        data = (json.dumps(payload) + "\n").encode("utf-8")
        self._sock.sendall(data)
        buf = b""
        while b"\n" not in buf:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise RuntimeError("Socket closed by Cocos Editor")
            buf += chunk
        line, _rest = buf.split(b"\n", 1)
        return json.loads(line.decode("utf-8"))

    def request(self, method: str, params: Any = None) -> Any:
        with self._lock:
            req_id = self._next_id
            self._next_id += 1
            payload = {"id": req_id, "method": method, "params": params}

            last_err: Optional[Exception] = None
            for attempt in range(self.max_retries):
                try:
                    logger.debug("-> %s (id=%s)", method, req_id)
                    resp = self._send(payload)
                    if resp.get("error"):
                        raise RuntimeError(
                            resp["error"].get("message", "Unknown error")
                        )
                    logger.debug("<- %s OK (id=%s)", method, req_id)
                    return resp.get("result")
                except (ConnectionError, OSError, RuntimeError) as e:
                    last_err = e
                    logger.warning(
                        "Request %s failed (attempt %d/%d): %s",
                        method,
                        attempt + 1,
                        self.max_retries,
                        e,
                    )
                    self._disconnect()
                    if attempt < self.max_retries - 1:
                        time.sleep(self.retry_delay)

            raise RuntimeError(
                f"Failed to communicate with Cocos Creator after {self.max_retries} attempts. "
                f"Make sure the editor is running with the cocos-mcp extension enabled. "
                f"Last error: {last_err}"
            )


# ======================================================================
# Action mapping tables
#
# Each entry: action_name -> (tcp_method, {snake_param: camelParam, ...})
# Keys not in the map are passed through as-is.
# ======================================================================

SCENE_ACTIONS: Dict[str, tuple] = {
    "get_active":               ("scene.getActive",              {}),
    "list_nodes":               ("scene.listNodes",              {"root_uuid": "rootUuid"}),
    "create_node":              ("scene.createNode",             {"parent_uuid": "parentUuid"}),
    "delete_node":              ("scene.deleteNode",             {}),
    "duplicate_node":           ("scene.duplicateNode",          {"parent_uuid": "parentUuid"}),
    "move_node":                ("scene.moveNode",               {"new_parent_uuid": "newParentUuid", "sibling_index": "siblingIndex"}),
    "get_node_props":           ("scene.getNodeProps",           {}),
    "set_node_props":           ("scene.setNodeProps",           {}),
    "add_component":            ("scene.addComponent",           {"comp_type": "type"}),
    "remove_component":         ("scene.removeComponent",        {"comp_type": "type"}),
    "get_component_props":      ("scene.getComponentProps",      {"comp_type": "type"}),
    "set_component_props":      ("scene.setComponentProps",      {"comp_type": "type"}),
    "create_ui_node":           ("scene.createUINode",           {"ui_type": "type", "parent_uuid": "parentUuid"}),
    "configure_widget":         ("scene.configureWidget",        {}),
    "configure_layout":         ("scene.configureLayout",        {}),
    "add_animation":            ("scene.addAnimation",           {}),
    "play_animation":           ("scene.playAnimation",          {"clip_name": "clipName", "cross_fade": "crossFade"}),
    "stop_animation":           ("scene.stopAnimation",          {}),
    "set_material_property":    ("scene.setMaterialProperty",    {"prop_name": "propName", "material_index": "materialIndex"}),
    "get_material_property":    ("scene.getMaterialProperty",    {"prop_name": "propName", "material_index": "materialIndex"}),
    "add_physics_body":         ("scene.addPhysicsBody",         {"collider_type": "colliderType", "body_type": "bodyType", "collider_params": "colliderParams"}),
    "configure_particle_system": ("scene.configureParticleSystem", {}),
    "get_prefab_info":          ("scene.getPrefabInfo",          {}),
    "get_logs":                 ("scene.getLogs",                {}),
}

ASSETS_ACTIONS: Dict[str, tuple] = {
    "find":             ("assets.find",             {"asset_type": "type"}),
    "get_info":         ("assets.getInfo",          {}),
    "create":           ("assets.create",           {}),
    "import_file":      ("assets.import",           {"file_path": "filePath", "target_dir": "targetDir"}),
    "move":             ("assets.move",             {"new_path": "newPath"}),
    "rename":           ("assets.rename",           {"new_name": "newName"}),
    "delete":           ("assets.delete",           {}),
    "get_dependencies": ("assets.getDependencies",  {}),
    "reveal":           ("assets.reveal",           {}),
    "request":          ("assets.request",          {}),
}

EDITOR_ACTIONS: Dict[str, tuple] = {
    "save_scene":          ("editor.saveScene",          {}),
    "query_dirty":         ("editor.queryDirty",         {}),
    "open_scene":          ("editor.openScene",          {}),
    "undo":                ("editor.undo",               {}),
    "redo":                ("editor.redo",               {}),
    "instantiate_prefab":  ("editor.instantiatePrefab",  {"asset_uuid": "assetUuid", "parent_uuid": "parentUuid"}),
    "create_prefab":       ("editor.createPrefab",       {"node_uuid": "nodeUuid"}),
    "get_logs":            ("editor.getLogs",             {}),
}


# ======================================================================
# Dispatch helper
# ======================================================================

def _convert_params(params: Optional[dict], key_map: dict) -> Optional[dict]:
    """Convert snake_case param keys to camelCase per the key_map."""
    if not params:
        return None
    payload: Dict[str, Any] = {}
    for k, v in params.items():
        if v is None:
            continue
        payload[key_map.get(k, k)] = v
    return payload or None


def _dispatch(client: CocosSocketClient, actions: dict, action: str, params: Optional[dict]) -> Any:
    """Route an action to the correct TCP method with param conversion."""
    if action not in actions:
        available = ", ".join(sorted(actions))
        raise ValueError(f"Unknown action: '{action}'. Available actions: {available}")
    tcp_method, key_map = actions[action]

    # Special handling: assets.create content serialization
    if tcp_method == "assets.create" and params and "content" in params:
        content = params["content"]
        if isinstance(content, (dict, list)):
            params = {**params, "content": json.dumps(content, ensure_ascii=False, indent=2)}

    converted = _convert_params(params, key_map)
    return client.request(tcp_method, converted)


# ======================================================================
# Reference documents (served as MCP Resources)
# ======================================================================

SCENE_REFERENCE = """\
# Scene Tool Reference

## Node properties (get_node_props / set_node_props)
Supported property names:
  position   -> [x, y, z]
  rotation   -> [x, y, z] (euler angles in degrees)
  scale      -> [x, y, z]
  active     -> bool
  name       -> str
  layer      -> int
  parentUuid -> str | null

## Component types (add_component / remove_component)
Built-in:
  cc.MeshRenderer, cc.Camera, cc.Light, cc.DirectionalLight,
  cc.Sprite, cc.Label, cc.Button, cc.Widget, cc.Layout,
  cc.ScrollView, cc.EditBox, cc.RichText, cc.ProgressBar,
  cc.Toggle, cc.Slider, cc.PageView,
  cc.Animation, cc.AudioSource,
  cc.RigidBody, cc.BoxCollider, cc.SphereCollider,
  cc.ParticleSystem, cc.UITransform, cc.Canvas
Custom: pass the @ccclass name directly (e.g. 'PlayerController').

## UI types (create_ui_node)
  Label       - text display (props: string, fontSize, color)
  Sprite      - image display
  Button      - clickable button with child Label (props: string, fontSize)
  Layout      - auto-layout container
  ScrollView  - scrollable area with Content child
  EditBox     - text input field
  Toggle      - checkbox/radio
  Slider      - value slider
  ProgressBar - progress indicator
  RichText    - rich text (props: string)

## Widget alignment (configure_widget)
  isAlignLeft (bool), left (number)
  isAlignRight (bool), right (number)
  isAlignTop (bool), top (number)
  isAlignBottom (bool), bottom (number)
  isAlignHorizontalCenter (bool), horizontalCenter (number)
  isAlignVerticalCenter (bool), verticalCenter (number)

## Layout types (configure_layout)
  type: 0=NONE, 1=HORIZONTAL, 2=VERTICAL, 3=GRID
  resizeMode: 0=NONE, 1=CONTAINER, 2=CHILDREN
  spacingX, spacingY, paddingLeft, paddingRight, paddingTop, paddingBottom

## Material (set_material_property / get_material_property)
  For color values pass [r, g, b, a] (0-255).
  Common uniforms: mainColor, albedo.

## Physics (add_physics_body)
  collider_type: 'box', 'sphere', 'capsule', 'cylinder', 'mesh'
  body_type: 'dynamic' (default), 'static', 'kinematic'
  collider_params: size ([x,y,z]) for box, radius for sphere,
    radius + height for capsule, center ([x,y,z]), isTrigger (bool)

## Particle system (configure_particle_system)
  duration (number), loop (bool), playOnAwake (bool), capacity (int),
  startLifetime (number), startSpeed (number), startSize (number),
  startColor ([r,g,b,a] 0-255), gravityModifier (number),
  rateOverTime (number), play (bool)

## Prefab info (get_prefab_info)
  Returns: isPrefab (bool), fileId (str|null), assetUuid (str|null), rootUuid (str|null)
"""

ASSETS_REFERENCE = """\
# Assets Tool Reference

## find
  pattern: glob pattern, e.g. 'db://assets/**', 'db://assets/**/*.ts'
  asset_type: optional filter, e.g. 'cc.ImageAsset', 'cc.Prefab', 'cc.Material', 'cc.SceneAsset'

## create
  path: db:// path including filename, e.g. 'db://assets/scripts/Player.ts'
  content: optional string or dict/list (auto JSON-serialized)

## import_file
  file_path: absolute filesystem path of the file to import
  target_dir: target db:// directory, e.g. 'db://assets/textures'

## move
  uuid: asset UUID
  new_path: new db:// path

## rename
  uuid: asset UUID
  new_name: new filename only (no directory)

## get_dependencies
  Note: direct dependency query not available in Cocos Creator 3.8.x.
  Returns asset meta with importer and sub-asset info.

## request (escape hatch)
  method: editor internal message name, e.g. 'query-assets', 'create-asset'
  params: parameters for the message
"""

EDITOR_REFERENCE = """\
# Editor Tool Reference

## open_scene
  uuid: UUID of the scene asset. Use assets(action="find", params={"asset_type": "cc.SceneAsset"}) to discover scenes.

## instantiate_prefab
  asset_uuid: UUID of the Prefab asset
  parent_uuid: optional parent node UUID

## create_prefab
  node_uuid: UUID of the scene node to save as prefab
  path: target db:// path, e.g. 'db://assets/prefabs/MyPrefab.prefab'

## get_logs
  level: optional filter ('log', 'info', 'warn', 'error')
  count: max entries (default 100, most recent first)
  pattern: optional regex filter (case-insensitive)
"""


# ======================================================================
# Server builder
# ======================================================================

def build_server(host: str, port: int) -> FastMCP:
    client = CocosSocketClient(host, port)
    mcp = FastMCP("CocosMCP")

    # ------------------------------------------------------------------
    # Tool: ping
    # ------------------------------------------------------------------

    @mcp.tool()
    def ping() -> str:
        """Check if the Cocos Creator editor is connected and responsive.

        Returns 'pong' if the editor extension is running and the TCP
        connection is alive. Use this to verify connectivity before
        performing other operations.
        """
        return client.request("ping")

    # ------------------------------------------------------------------
    # Tool: execute
    # ------------------------------------------------------------------

    @mcp.tool()
    def execute(scope: str, code: str, args: Optional[list] = None) -> Any:
        """Execute arbitrary JavaScript code inside the Cocos Creator editor.

        This is a powerful escape hatch for operations not covered by
        dedicated tools. Prefer specific tools when available.

        Args:
            scope: 'scene' to run in the engine renderer process (access
                   to the full cc.* API), or 'main' to run in the editor
                   main process (access to the Editor.* API).
            code: JavaScript code string. In 'scene' scope the globals
                  'cc' and 'args' are available. In 'main' scope the
                  globals 'Editor' and 'args' are available.
            args: Optional list of arguments accessible as 'args' in the
                  executed code.
        """
        return client.request(
            "execute", {"scope": scope, "code": code, "args": args or []}
        )

    # ------------------------------------------------------------------
    # Tool: scene
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene(action: str, params: Optional[dict] = None) -> Any:
        """Operate on the Cocos Creator scene. Read cocos://reference/scene for details.

        action                    | params
        --------------------------|-------
        get_active                | (none)
        list_nodes                | root_uuid?
        create_node               | name, parent_uuid?
        delete_node               | uuid
        duplicate_node            | uuid, parent_uuid?
        move_node                 | uuid, new_parent_uuid, sibling_index?
        get_node_props            | uuid, props (list)
        set_node_props            | uuid, props (dict)
        add_component             | uuid, comp_type
        remove_component          | uuid, comp_type
        get_component_props       | uuid, comp_type, props (list)
        set_component_props       | uuid, comp_type, props (dict)
        create_ui_node            | ui_type, parent_uuid?, name?, props?
        configure_widget          | uuid, props (dict)
        configure_layout          | uuid, props (dict)
        add_animation             | uuid
        play_animation            | uuid, clip_name?, cross_fade?
        stop_animation            | uuid
        set_material_property     | uuid, prop_name, value, material_index?
        get_material_property     | uuid, prop_name, material_index?
        add_physics_body          | uuid, collider_type, body_type?, collider_params?
        configure_particle_system | uuid, props (dict)
        get_prefab_info           | uuid
        get_logs                  | level?, count?, pattern?
        """
        return _dispatch(client, SCENE_ACTIONS, action, params)

    # ------------------------------------------------------------------
    # Tool: assets
    # ------------------------------------------------------------------

    @mcp.tool()
    def assets(action: str, params: Optional[dict] = None) -> Any:
        """Manage Cocos Creator project assets. Read cocos://reference/assets for details.

        action           | params
        -----------------|-------
        find             | pattern?, asset_type?
        get_info         | uuid
        create           | path, content?
        import_file      | file_path, target_dir
        move             | uuid, new_path
        rename           | uuid, new_name
        delete           | uuid
        get_dependencies | uuid
        reveal           | uuid
        request          | method, params?
        """
        return _dispatch(client, ASSETS_ACTIONS, action, params)

    # ------------------------------------------------------------------
    # Tool: editor
    # ------------------------------------------------------------------

    @mcp.tool()
    def editor(action: str, params: Optional[dict] = None) -> Any:
        """Editor-level operations in Cocos Creator. Read cocos://reference/editor for details.

        action              | params
        --------------------|-------
        save_scene          | (none)
        query_dirty         | (none)
        open_scene          | uuid
        undo                | (none)
        redo                | (none)
        instantiate_prefab  | asset_uuid, parent_uuid?
        create_prefab       | node_uuid, path
        get_logs            | level?, count?, pattern?
        """
        return _dispatch(client, EDITOR_ACTIONS, action, params)

    # ------------------------------------------------------------------
    # Resources: detailed reference docs
    # ------------------------------------------------------------------

    @mcp.resource("cocos://reference/scene")
    def scene_reference() -> str:
        """Detailed reference for all scene actions, component types, UI types, widget/layout properties, physics, particles, and materials."""
        return SCENE_REFERENCE

    @mcp.resource("cocos://reference/assets")
    def assets_reference() -> str:
        """Detailed reference for all asset actions and their parameters."""
        return ASSETS_REFERENCE

    @mcp.resource("cocos://reference/editor")
    def editor_reference() -> str:
        """Detailed reference for all editor actions and their parameters."""
        return EDITOR_REFERENCE

    return mcp


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Cocos Creator MCP server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    logger.info(
        "Starting Cocos MCP server (editor at %s:%s)", args.host, args.port
    )
    server = build_server(args.host, args.port)
    server.run()


if __name__ == "__main__":
    main()
