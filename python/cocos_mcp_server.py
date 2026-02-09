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

        Args:
            uuid: UUID of the node to add the component to.
            comp_type: Fully qualified component class name
                       (e.g. 'cc.Sprite').
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
        asset_type: str, path: str, template: Optional[dict] = None
    ) -> Any:
        """Create a new asset in the project.

        Args:
            asset_type: Asset type (e.g. 'cc.Script', 'cc.Material',
                        'cc.AnimationClip').
            path: Target db:// path including filename
                  (e.g. 'db://assets/scripts/Player.ts').
            template: Optional template data for the asset content.
        """
        payload: Dict[str, Any] = {"type": asset_type, "path": path}
        if template is not None:
            payload["template"] = template
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
        """List assets that the given asset depends on.

        Args:
            uuid: UUID of the asset.
            deep: If True, recursively resolve all transitive
                  dependencies.
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
