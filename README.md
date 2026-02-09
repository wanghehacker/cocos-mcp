# Cocos MCP

A Cocos Creator 3.8.x MCP bridge for code agents. The editor extension runs a local TCP socket server, and a Python MCP server (stdio) forwards tools over that socket. This mirrors the Blender MCP architecture.

## Architecture
- **Editor extension (TS)**: `packages/cocos-mcp` starts a TCP server inside Cocos Creator.
- **MCP server (Python)**: `python/cocos_mcp_server.py` exposes tools over stdio and talks to the editor socket.

```
MCP Client (Claude Code / Cursor)
    ↕ stdio (MCP protocol)
Python MCP Server (cocos_mcp_server.py)
    ↕ TCP socket (JSON-RPC, port 8787)
Cocos Editor Extension (packages/cocos-mcp)
    ↕ Editor.Message / scene script APIs
Cocos Creator Engine
```

## Install (Editor Side)
1. Copy `packages/cocos-mcp` into your Cocos project:
   - Preferred: `extensions/cocos-mcp`
   - Legacy: `packages/cocos-mcp`
2. Restart Cocos Creator and enable the extension in Extension Manager.
3. Optional: set port via env var before launching editor:
   - `COCOS_MCP_PORT=8787`

If you change TypeScript, rebuild:
```sh
npx tsc -p packages/cocos-mcp/tsconfig.json
```

## Install (Python Side)
```sh
cd python && uv sync
```

## Run MCP Server
```sh
cd python && uv run python cocos_mcp_server.py --host 127.0.0.1 --port 8787
```

## Claude Code Integration

The project includes a `.mcp.json` file at the root. When you open this project directory in Claude Code, it will automatically discover the MCP server.

You can also manually add the configuration to your Claude Code settings:

```json
{
  "mcpServers": {
    "cocos-mcp": {
      "command": "uv",
      "args": ["run", "--directory", "python", "python", "cocos_mcp_server.py", "--port", "8787"]
    }
  }
}
```

For Cursor or other MCP clients, use the same configuration format in the appropriate settings file.

## Tools

### Scene
- `scene_get_active` – Get the active scene name and UUID
- `scene_list_nodes` – List all nodes as a tree structure
- `scene_create_node` – Create a new empty node
- `scene_delete_node` – Delete a node and its children
- `scene_duplicate_node` – Deep clone a node
- `scene_move_node` – Reparent a node
- `scene_get_node_props` – Read node properties (position, rotation, scale, etc.)
- `scene_set_node_props` – Set node properties
- `scene_add_component` – Add a component to a node
- `scene_remove_component` – Remove a component from a node
- `scene_get_component_props` – Read component properties
- `scene_set_component_props` – Set component properties

### Editor
- `editor_save_scene` – Save the current scene
- `editor_query_dirty` – Check if scene has unsaved changes
- `editor_open_scene` – Open a scene by UUID
- `editor_undo` – Undo last operation
- `editor_redo` – Redo last undone operation

### UI
- `scene_create_ui_node` – Create a complete UI node (Button, Label, Sprite, Layout, etc.)
- `scene_configure_widget` – Configure Widget alignment on a node
- `scene_configure_layout` – Configure Layout component on a node

### Animation
- `scene_add_animation` – Add Animation component to a node
- `scene_play_animation` – Play animation on a node
- `scene_stop_animation` – Stop animation on a node

### Rendering & Physics
- `scene_set_material_property` – Set material uniform on MeshRenderer
- `scene_get_material_property` – Read material uniform from MeshRenderer
- `scene_add_physics_body` – Add RigidBody + Collider in one step
- `scene_configure_particle_system` – Configure ParticleSystem on a node

### Assets
- `assets_find` – Search assets by glob pattern
- `assets_get_info` – Get asset metadata by UUID
- `assets_create` – Create a new asset
- `assets_import` – Import an external file as an asset
- `assets_move` – Move an asset to a new path
- `assets_rename` – Rename an asset
- `assets_delete` – Delete an asset
- `assets_get_dependencies` – List asset dependencies
- `assets_reveal` – Reveal asset in OS file explorer
- `assets_request` – Raw asset-db message passthrough

### Execute
- `execute(scope, code, args)` – Run arbitrary JS in `scene` or `main` scope

## Troubleshooting

### "Failed to communicate with Cocos Creator"
- Make sure Cocos Creator is running and the project with the extension is open.
- Check that the extension is enabled in Extension Manager.
- Verify the port matches (default 8787). Check the editor console for `[cocos-mcp] TCP server listening on 127.0.0.1:8787`.

### Port already in use
- Another instance may be using port 8787. Set a different port:
  ```sh
  COCOS_MCP_PORT=8788 # set before launching Cocos Creator
  python python/cocos_mcp_server.py --port 8788
  ```

### Extension not loading
- Ensure `package.json` has `"package_version": 2` and `"editor": ">=3.8.0"`.
- The extension folder must be named `cocos-mcp` (matching the `name` field).
- Check the editor console for error messages.

### Scene operations return "No active scene"
- Open a scene in the editor before calling scene tools.

## Notes
- Asset operations map to common `asset-db` message names (e.g. `query-assets`). If your editor build differs, use `assets_request` with the exact method name.
- Scene modifications via MCP do not currently trigger the editor's undo system. Save your scene before making bulk changes.
