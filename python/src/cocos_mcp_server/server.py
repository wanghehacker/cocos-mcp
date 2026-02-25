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


def build_server(host: str, port: int) -> FastMCP:
    client = CocosSocketClient(host, port)
    mcp = FastMCP("CocosMCP")

    # ------------------------------------------------------------------
    # Connectivity
    # ------------------------------------------------------------------

    @mcp.tool()
    def ping() -> str:
        """Check if the Cocos Creator editor is connected and responsive.

        Returns 'pong' if the editor extension is running and the TCP
        connection is alive. Use this to verify connectivity before
        performing other operations.
        """
        return client.request("ping")

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
    # Scene – queries
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_get_active() -> Any:
        """Get the name and UUID of the currently active scene.

        Returns a dict with 'name' and 'uuid' keys. Use this as a
        starting point to understand what scene is open in the editor.
        """
        return client.request("scene.getActive")

    @mcp.tool()
    def scene_list_nodes(root_uuid: Optional[str] = None) -> Any:
        """List all nodes in the current scene as a tree structure.

        Each node in the returned tree contains: uuid, name, path,
        active (bool), and children (list). Use the uuid values to
        reference nodes in other operations.

        Args:
            root_uuid: Optional UUID of a node to use as the subtree
                       root. If omitted the entire scene tree is returned.
        """
        return client.request(
            "scene.listNodes", {"rootUuid": root_uuid} if root_uuid else {}
        )

    # ------------------------------------------------------------------
    # Scene – node CRUD
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_create_node(name: str, parent_uuid: Optional[str] = None) -> Any:
        """Create a new empty node in the scene.

        Returns the new node's uuid, name, and parentUuid.

        Args:
            name: Display name for the new node.
            parent_uuid: UUID of the parent node. If omitted the node is
                         added directly under the scene root.
        """
        return client.request(
            "scene.createNode", {"name": name, "parentUuid": parent_uuid}
        )

    @mcp.tool()
    def scene_delete_node(uuid: str) -> Any:
        """Delete a node and all its children from the scene.

        Args:
            uuid: UUID of the node to delete.
        """
        return client.request("scene.deleteNode", {"uuid": uuid})

    @mcp.tool()
    def scene_duplicate_node(
        uuid: str, parent_uuid: Optional[str] = None
    ) -> Any:
        """Duplicate (deep clone) an existing node including components and children.

        Args:
            uuid: UUID of the node to duplicate.
            parent_uuid: UUID of the parent for the clone. If omitted the
                         clone is placed under the same parent as the
                         original.
        """
        return client.request(
            "scene.duplicateNode", {"uuid": uuid, "parentUuid": parent_uuid}
        )

    @mcp.tool()
    def scene_move_node(
        uuid: str,
        new_parent_uuid: str,
        sibling_index: Optional[int] = None,
    ) -> Any:
        """Move a node to a different parent in the scene hierarchy.

        Args:
            uuid: UUID of the node to move.
            new_parent_uuid: UUID of the new parent node.
            sibling_index: Optional 0-based position among siblings.
                           If omitted the node is appended as the last
                           child.
        """
        payload: Dict[str, Any] = {
            "uuid": uuid,
            "newParentUuid": new_parent_uuid,
        }
        if sibling_index is not None:
            payload["siblingIndex"] = sibling_index
        return client.request("scene.moveNode", payload)

    # ------------------------------------------------------------------
    # Scene – node properties
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_get_node_props(uuid: str, props: list) -> Any:
        """Read properties of a scene node.

        Supported property names:
          - 'position'   -> [x, y, z]
          - 'rotation'   -> [x, y, z] (euler angles in degrees)
          - 'scale'      -> [x, y, z]
          - 'active'     -> bool
          - 'name'       -> str
          - 'layer'      -> int
          - 'parentUuid' -> str | null

        Args:
            uuid: UUID of the node.
            props: List of property names to retrieve,
                   e.g. ['position', 'rotation', 'scale'].
        """
        return client.request(
            "scene.getNodeProps", {"uuid": uuid, "props": props}
        )

    @mcp.tool()
    def scene_set_node_props(uuid: str, props: dict) -> Any:
        """Set properties on a scene node.

        Supported properties and expected value formats:
          - position: [x, y, z]
          - rotation: [x, y, z] (euler angles in degrees)
          - scale:    [x, y, z]
          - active:   bool
          - name:     str
          - layer:    int

        Example: {"position": [0, 5, 0], "scale": [2, 2, 2]}

        Args:
            uuid: UUID of the node to modify.
            props: Dict mapping property names to new values.
        """
        return client.request(
            "scene.setNodeProps", {"uuid": uuid, "props": props}
        )

    # ------------------------------------------------------------------
    # Scene – components
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_add_component(uuid: str, comp_type: str) -> Any:
        """Add a component to a node.

        Common built-in component types:
          cc.MeshRenderer, cc.Camera, cc.Light, cc.DirectionalLight,
          cc.Sprite, cc.Label, cc.Button, cc.Widget, cc.Layout,
          cc.ScrollView, cc.EditBox, cc.RichText, cc.ProgressBar,
          cc.Toggle, cc.Slider, cc.PageView,
          cc.Animation, cc.AudioSource,
          cc.RigidBody, cc.BoxCollider, cc.SphereCollider,
          cc.ParticleSystem, cc.UITransform, cc.Canvas

        Custom script components registered via @ccclass are also
        supported — pass the ccclass name directly
        (e.g. 'WaterReflection', 'PlayerController').

        Args:
            uuid: UUID of the node to add the component to.
            comp_type: Component class name. Use 'cc.Xxx' for built-in
                       components or the @ccclass name for custom scripts
                       (e.g. 'WaterReflection').
        """
        return client.request(
            "scene.addComponent", {"uuid": uuid, "type": comp_type}
        )

    @mcp.tool()
    def scene_remove_component(uuid: str, comp_type: str) -> Any:
        """Remove a component from a node by type.

        If the node has multiple components of the same type, the first
        one found is removed.

        Args:
            uuid: UUID of the node.
            comp_type: Component class name to remove (e.g. 'cc.Sprite').
        """
        return client.request(
            "scene.removeComponent", {"uuid": uuid, "type": comp_type}
        )

    @mcp.tool()
    def scene_get_component_props(
        uuid: str, comp_type: str, props: list
    ) -> Any:
        """Read properties from a specific component on a node.

        Args:
            uuid: UUID of the node.
            comp_type: Component class name (e.g. 'cc.Camera').
            props: List of property names to read from the component.
        """
        return client.request(
            "scene.getComponentProps",
            {"uuid": uuid, "type": comp_type, "props": props},
        )

    @mcp.tool()
    def scene_set_component_props(
        uuid: str, comp_type: str, props: dict
    ) -> Any:
        """Set properties on a specific component of a node.

        Args:
            uuid: UUID of the node.
            comp_type: Component class name (e.g. 'cc.Camera').
            props: Dict mapping property names to new values.
        """
        return client.request(
            "scene.setComponentProps",
            {"uuid": uuid, "type": comp_type, "props": props},
        )

    # ------------------------------------------------------------------
    # Assets
    # ------------------------------------------------------------------

    @mcp.tool()
    def assets_find(
        pattern: str = "db://assets/**", asset_type: Optional[str] = None
    ) -> Any:
        """Search for assets in the project by glob pattern.

        Args:
            pattern: Glob pattern for asset paths.
                     Examples: 'db://assets/**' (all assets),
                     'db://assets/**/*.ts' (TypeScript files),
                     'db://assets/textures/**' (textures folder).
            asset_type: Optional type filter
                        (e.g. 'cc.ImageAsset', 'cc.Prefab', 'cc.Material').
        """
        payload: Dict[str, Any] = {"pattern": pattern}
        if asset_type:
            payload["type"] = asset_type
        return client.request("assets.find", payload)

    @mcp.tool()
    def assets_get_info(uuid: str) -> Any:
        """Get detailed metadata about an asset by UUID.

        Returns information such as path, type, and other properties
        stored in the asset database.

        Args:
            uuid: UUID of the asset.
        """
        return client.request("assets.getInfo", {"uuid": uuid})

    @mcp.tool()
    def assets_create(
        path: str, content: Optional[Any] = None
    ) -> Any:
        """Create a new asset in the project.

        Args:
            path: Target db:// path including filename
                  (e.g. 'db://assets/scripts/Player.ts').
            content: Optional file content for the asset. Can be a string
                     or a dict/object (will be JSON-serialized).
        """
        payload: Dict[str, Any] = {"path": path}
        if content is not None:
            # If content is a dict/list, serialize to JSON string
            if isinstance(content, (dict, list)):
                payload["content"] = json.dumps(content, ensure_ascii=False, indent=2)
            else:
                payload["content"] = content
        return client.request("assets.create", payload)

    @mcp.tool()
    def assets_import(file_path: str, target_dir: str) -> Any:
        """Import an external file into the project as an asset.

        Args:
            file_path: Absolute filesystem path of the file to import.
            target_dir: Target db:// directory
                        (e.g. 'db://assets/textures').
        """
        return client.request(
            "assets.import", {"filePath": file_path, "targetDir": target_dir}
        )

    @mcp.tool()
    def assets_move(uuid: str, new_path: str) -> Any:
        """Move an asset to a new location within the project.

        Args:
            uuid: UUID of the asset to move.
            new_path: New db:// path for the asset.
        """
        return client.request(
            "assets.move", {"uuid": uuid, "newPath": new_path}
        )

    @mcp.tool()
    def assets_rename(uuid: str, new_name: str) -> Any:
        """Rename an asset (filename only, not its directory).

        Args:
            uuid: UUID of the asset.
            new_name: New filename (without directory path).
        """
        return client.request(
            "assets.rename", {"uuid": uuid, "newName": new_name}
        )

    @mcp.tool()
    def assets_delete(uuid: str) -> Any:
        """Permanently delete an asset from the project.

        Args:
            uuid: UUID of the asset to delete.
        """
        return client.request("assets.delete", {"uuid": uuid})

    @mcp.tool()
    def assets_get_dependencies(uuid: str, deep: bool = False) -> Any:
        """Get asset metadata including dependency information.

        Note: Direct dependency query is not available in Cocos Creator 3.8.x.
        Returns the asset meta which contains importer and sub-asset info.

        Args:
            uuid: UUID of the asset.
            deep: Currently unused, reserved for future use.
        """
        return client.request(
            "assets.getDependencies", {"uuid": uuid, "deep": deep}
        )

    @mcp.tool()
    def assets_reveal(uuid: str) -> Any:
        """Reveal an asset in the operating system file explorer.

        Args:
            uuid: UUID of the asset to reveal.
        """
        return client.request("assets.reveal", {"uuid": uuid})

    @mcp.tool()
    def assets_request(method: str, params: Any = None) -> Any:
        """Send a raw asset-db message to the editor (escape hatch).

        Use this for asset-db operations not covered by other tools.
        The method name should match the editor's internal message name
        (e.g. 'query-assets', 'create-asset').

        Args:
            method: The asset-db message name.
            params: Parameters for the message.
        """
        return client.request(
            "assets.request", {"method": method, "params": params}
        )

    # ------------------------------------------------------------------
    # Editor operations (main process)
    # ------------------------------------------------------------------

    @mcp.tool()
    def editor_save_scene() -> Any:
        """Save the currently open scene in Cocos Creator.

        Persists all unsaved changes to disk.
        """
        return client.request("editor.saveScene")

    @mcp.tool()
    def editor_query_dirty() -> Any:
        """Check whether the current scene has unsaved changes.

        Returns True if the scene has been modified since the last save.
        """
        return client.request("editor.queryDirty")

    @mcp.tool()
    def editor_open_scene(uuid: str) -> Any:
        """Open a scene by its asset UUID.

        Use assets_find with asset_type='cc.SceneAsset' to discover
        available scenes and their UUIDs.

        Args:
            uuid: UUID of the scene asset to open.
        """
        return client.request("editor.openScene", {"uuid": uuid})

    @mcp.tool()
    def editor_undo() -> Any:
        """Undo the last operation in the scene editor."""
        return client.request("editor.undo")

    @mcp.tool()
    def editor_redo() -> Any:
        """Redo the last undone operation in the scene editor."""
        return client.request("editor.redo")

    @mcp.tool()
    def editor_get_logs(
        level: Optional[str] = None,
        count: int = 100,
        pattern: Optional[str] = None,
    ) -> Any:
        """Read recent console log entries from the Cocos Creator editor main process.

        Returns a list of log entries, each with timestamp (ms), level, and message.
        Useful for debugging editor extension issues or monitoring editor activity.

        Args:
            level: Optional filter by log level ('log', 'info', 'warn', 'error').
            count: Maximum number of entries to return (default 100, most recent first).
            pattern: Optional regex pattern to filter log messages (case-insensitive).
        """
        payload: Dict[str, Any] = {"count": count}
        if level:
            payload["level"] = level
        if pattern:
            payload["pattern"] = pattern
        result = client.request("editor.getLogs", payload)
        return json.dumps(result, indent=2, ensure_ascii=False)

    @mcp.tool()
    def scene_get_logs(
        level: Optional[str] = None,
        count: int = 100,
        pattern: Optional[str] = None,
    ) -> Any:
        """Read recent console log entries from the Cocos Creator scene (engine renderer) process.

        Returns a list of log entries, each with timestamp (ms), level, and message.
        Useful for debugging scene scripts, component logic, or rendering issues.

        Args:
            level: Optional filter by log level ('log', 'info', 'warn', 'error').
            count: Maximum number of entries to return (default 100, most recent first).
            pattern: Optional regex pattern to filter log messages (case-insensitive).
        """
        payload: Dict[str, Any] = {"count": count}
        if level:
            payload["level"] = level
        if pattern:
            payload["pattern"] = pattern
        result = client.request("scene.getLogs", payload)
        return json.dumps(result, indent=2, ensure_ascii=False)

    # ------------------------------------------------------------------
    # UI convenience methods
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_create_ui_node(
        ui_type: str,
        parent_uuid: Optional[str] = None,
        name: Optional[str] = None,
        props: Optional[dict] = None,
    ) -> Any:
        """Create a complete UI node with all required components in one step.

        This is a convenience method that creates a Node with UITransform
        and the appropriate UI component(s) already attached.

        Supported types:
          Label    - text display (props: string, fontSize, color)
          Sprite   - image display
          Button   - clickable button with child Label (props: string, fontSize)
          Layout   - auto-layout container
          ScrollView - scrollable area with Content child
          EditBox  - text input field
          Toggle   - checkbox/radio
          Slider   - value slider
          ProgressBar - progress indicator
          RichText - rich text (props: string)

        Args:
            ui_type: One of the supported UI types listed above.
            parent_uuid: UUID of the parent node. Defaults to scene root.
            name: Display name for the node. Defaults to the type name.
            props: Optional initial properties. Supported keys depend on
                   the type (e.g. string, fontSize, color, contentSize).
        """
        payload: Dict[str, Any] = {"type": ui_type}
        if parent_uuid:
            payload["parentUuid"] = parent_uuid
        if name:
            payload["name"] = name
        if props:
            payload["props"] = props
        return client.request("scene.createUINode", payload)

    @mcp.tool()
    def scene_configure_widget(uuid: str, props: dict) -> Any:
        """Configure Widget alignment on a node (auto-adds Widget if missing).

        Supported props:
          isAlignLeft (bool), left (number),
          isAlignRight (bool), right (number),
          isAlignTop (bool), top (number),
          isAlignBottom (bool), bottom (number),
          isAlignHorizontalCenter (bool), horizontalCenter (number),
          isAlignVerticalCenter (bool), verticalCenter (number)

        Args:
            uuid: UUID of the node.
            props: Dict of Widget alignment properties.
        """
        return client.request(
            "scene.configureWidget", {"uuid": uuid, "props": props}
        )

    @mcp.tool()
    def scene_configure_layout(uuid: str, props: dict) -> Any:
        """Configure Layout component on a node (auto-adds Layout if missing).

        Supported props:
          type (int): 0=NONE, 1=HORIZONTAL, 2=VERTICAL, 3=GRID
          resizeMode (int): 0=NONE, 1=CONTAINER, 2=CHILDREN
          spacingX (number), spacingY (number),
          paddingLeft, paddingRight, paddingTop, paddingBottom (number)

        Args:
            uuid: UUID of the node.
            props: Dict of Layout properties.
        """
        return client.request(
            "scene.configureLayout", {"uuid": uuid, "props": props}
        )

    # ------------------------------------------------------------------
    # Animation
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_add_animation(uuid: str) -> Any:
        """Add an Animation component to a node (or return existing one).

        Args:
            uuid: UUID of the node.
        """
        return client.request("scene.addAnimation", {"uuid": uuid})

    @mcp.tool()
    def scene_play_animation(
        uuid: str,
        clip_name: Optional[str] = None,
        cross_fade: Optional[float] = None,
    ) -> Any:
        """Play an animation on a node's Animation component.

        Args:
            uuid: UUID of the node with an Animation component.
            clip_name: Name of the clip to play. If omitted, plays the
                       default clip.
            cross_fade: If provided along with clip_name, cross-fades to
                        the clip over this duration in seconds.
        """
        payload: Dict[str, Any] = {"uuid": uuid}
        if clip_name:
            payload["clipName"] = clip_name
        if cross_fade is not None:
            payload["crossFade"] = cross_fade
        return client.request("scene.playAnimation", payload)

    @mcp.tool()
    def scene_stop_animation(uuid: str) -> Any:
        """Stop all animations on a node's Animation component.

        Args:
            uuid: UUID of the node.
        """
        return client.request("scene.stopAnimation", {"uuid": uuid})

    # ------------------------------------------------------------------
    # Rendering & Physics
    # ------------------------------------------------------------------

    @mcp.tool()
    def scene_set_material_property(
        uuid: str,
        prop_name: str,
        value: Any,
        material_index: int = 0,
    ) -> Any:
        """Set a material uniform property on a node's MeshRenderer.

        For color values, pass a list of [r, g, b, a] (0-255).

        Args:
            uuid: UUID of the node with a MeshRenderer.
            prop_name: Shader uniform name (e.g. 'mainColor', 'albedo').
            value: The value to set (number, list, etc.).
            material_index: Index of the material slot (default 0).
        """
        return client.request(
            "scene.setMaterialProperty",
            {
                "uuid": uuid,
                "materialIndex": material_index,
                "propName": prop_name,
                "value": value,
            },
        )

    @mcp.tool()
    def scene_get_material_property(
        uuid: str, prop_name: str, material_index: int = 0
    ) -> Any:
        """Read a material uniform property from a node's MeshRenderer.

        Args:
            uuid: UUID of the node with a MeshRenderer.
            prop_name: Shader uniform name to read.
            material_index: Index of the material slot (default 0).
        """
        return client.request(
            "scene.getMaterialProperty",
            {
                "uuid": uuid,
                "materialIndex": material_index,
                "propName": prop_name,
            },
        )

    @mcp.tool()
    def scene_add_physics_body(
        uuid: str,
        collider_type: str,
        body_type: str = "dynamic",
        collider_params: Optional[dict] = None,
    ) -> Any:
        """Add a RigidBody and Collider to a node in one step.

        Args:
            uuid: UUID of the node.
            collider_type: 'box', 'sphere', 'capsule', 'cylinder', or 'mesh'.
            body_type: 'dynamic' (default), 'static', or 'kinematic'.
            collider_params: Optional dict with collider settings:
                size ([x,y,z]) for box, radius (number) for sphere,
                radius + height for capsule, center ([x,y,z]),
                isTrigger (bool).
        """
        payload: Dict[str, Any] = {
            "uuid": uuid,
            "bodyType": body_type,
            "colliderType": collider_type,
        }
        if collider_params:
            payload["colliderParams"] = collider_params
        return client.request("scene.addPhysicsBody", payload)

    @mcp.tool()
    def scene_configure_particle_system(uuid: str, props: dict) -> Any:
        """Configure a ParticleSystem on a node (auto-adds if missing).

        Supported props:
          duration (number), loop (bool), playOnAwake (bool),
          capacity (int),
          startLifetime (number), startSpeed (number), startSize (number),
          startColor ([r,g,b,a] 0-255),
          gravityModifier (number), rateOverTime (number),
          play (bool) - if true, starts playback immediately

        Args:
            uuid: UUID of the node.
            props: Dict of particle system properties.
        """
        return client.request(
            "scene.configureParticleSystem", {"uuid": uuid, "props": props}
        )

    # ------------------------------------------------------------------
    # Prefab
    # ------------------------------------------------------------------

    @mcp.tool()
    def editor_instantiate_prefab(
        asset_uuid: str, parent_uuid: Optional[str] = None
    ) -> Any:
        """Instantiate a Prefab asset into the current scene.

        Creates a new node in the scene from an existing Prefab asset.
        Use assets_find with asset_type='cc.Prefab' to discover available
        prefabs and their UUIDs.

        Args:
            asset_uuid: UUID of the Prefab asset to instantiate.
            parent_uuid: Optional UUID of the parent node. If omitted the
                         prefab instance is added under the scene root.
        """
        payload: Dict[str, Any] = {"assetUuid": asset_uuid}
        if parent_uuid:
            payload["parentUuid"] = parent_uuid
        return client.request("editor.instantiatePrefab", payload)

    @mcp.tool()
    def editor_create_prefab(node_uuid: str, path: str) -> Any:
        """Create a Prefab asset from an existing scene node.

        Saves the node (and its children/components) as a .prefab asset
        file in the project.

        Args:
            node_uuid: UUID of the scene node to save as a prefab.
            path: Target db:// path for the prefab file, e.g.
                  'db://assets/prefabs/MyPrefab.prefab'.
        """
        return client.request(
            "editor.createPrefab", {"nodeUuid": node_uuid, "path": path}
        )

    @mcp.tool()
    def scene_get_prefab_info(uuid: str) -> Any:
        """Query whether a node is a Prefab instance and get its prefab metadata.

        Returns a dict with:
          - isPrefab (bool): whether the node is a prefab instance
          - fileId (str|null): prefab internal file ID
          - assetUuid (str|null): UUID of the source Prefab asset
          - rootUuid (str|null): UUID of the prefab root node

        Args:
            uuid: UUID of the node to query.
        """
        return client.request("scene.getPrefabInfo", {"uuid": uuid})

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
