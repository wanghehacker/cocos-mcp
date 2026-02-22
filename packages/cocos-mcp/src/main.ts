import net from "net";

type MCPRequest = {
  id: number;
  method: string;
  params?: any;
};

type MCPResponse = {
  id: number;
  result?: any;
  error?: { message: string };
};

const DEFAULT_PORT = 8787;
let server: net.Server | null = null;
const activeSockets = new Set<net.Socket>();

function log(level: "info" | "warn" | "error", msg: string) {
  const prefix = "[cocos-mcp]";
  console[level](`${prefix} ${msg}`);
}

function getPort(): number {
  const envPort = process.env.COCOS_MCP_PORT;
  if (envPort && Number.isFinite(Number(envPort))) {
    return Number(envPort);
  }
  try {
    const profileGet = (Editor as any)?.Profile?.getProject;
    if (profileGet) {
      const port = profileGet("cocos-mcp", "port");
      if (Number.isFinite(Number(port))) {
        return Number(port);
      }
    }
  } catch {
    // Ignore profile errors and fall back to default.
  }
  return DEFAULT_PORT;
}

function toLine(obj: any): string {
  return `${JSON.stringify(obj)}\n`;
}

async function handleRequest(req: MCPRequest): Promise<MCPResponse> {
  log("info", `<-- ${req.method} (id=${req.id})`);
  try {
    const result = await dispatch(req.method, req.params);
    log("info", `--> ${req.method} OK (id=${req.id})`);
    return { id: req.id, result };
  } catch (err: any) {
    log("warn", `--> ${req.method} ERROR: ${err?.message} (id=${req.id})`);
    return {
      id: req.id,
      error: { message: err?.message || String(err) },
    };
  }
}

async function dispatch(method: string, params?: any): Promise<any> {
  if (method === "ping") {
    return "pong";
  }
  if (method === "execute") {
    return execute(params);
  }
  if (method.startsWith("scene.")) {
    return sceneDispatch(method.slice("scene.".length), params);
  }
  if (method.startsWith("assets.")) {
    return assetsDispatch(method.slice("assets.".length), params);
  }
  if (method.startsWith("editor.")) {
    return editorDispatch(method.slice("editor.".length), params);
  }
  throw new Error(`Unknown method: ${method}`);
}

async function execute(params: any): Promise<any> {
  if (!params || typeof params.scope !== "string" || typeof params.code !== "string") {
    throw new Error("execute requires { scope, code, args? }");
  }
  if (params.scope === "scene") {
    return sceneDispatch("execute", params);
  }
  if (params.scope === "main") {
    // Use AsyncFunction to support top-level await in user code
    // eslint-disable-next-line no-new-func
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("Editor", "args", params.code);
    return fn(Editor, params.args || []);
  }
  throw new Error(`Unknown execute scope: ${params.scope}`);
}

async function sceneDispatch(method: string, params?: any): Promise<any> {
  const message = (Editor as any)?.Message;
  if (!message?.request) {
    throw new Error("Editor.Message.request is not available");
  }
  return message.request("scene", "execute-scene-script", {
    name: "cocos-mcp",
    method,
    args: Array.isArray(params) ? params : params !== undefined ? [params] : [],
  });
}

async function assetsDispatch(method: string, params?: any): Promise<any> {
  const message = (Editor as any)?.Message;
  if (!message?.request) {
    throw new Error("Editor.Message.request is not available");
  }

  switch (method) {
    case "find": {
      // query-assets expects a glob pattern (e.g. "db://assets/**/*.ts").
      // If the pattern looks like an exact path (no wildcards), use
      // query-asset-info for a precise single-asset lookup instead.
      const pattern = params?.pattern || "db://assets/**";
      const isExactPath = !pattern.includes("*") && !pattern.includes("?");

      if (isExactPath) {
        // Exact path — return single-element array (or empty if not found)
        try {
          const info = await message.request("asset-db", "query-asset-info", pattern);
          if (info) {
            const results = [info];
            if (params?.type && info.type !== params.type) {
              return [];
            }
            return results;
          }
        } catch {
          // Fall through to glob query
        }
        return [];
      }

      const results = await message.request("asset-db", "query-assets", pattern);
      // Apply optional type filter on the client side
      if (params?.type && Array.isArray(results)) {
        return results.filter((a: any) => a.type === params.type);
      }
      return results;
    }
    case "getInfo": {
      // query-asset-info expects (uuid: string)
      if (!params?.uuid) {
        throw new Error("assets.getInfo requires { uuid }");
      }
      return message.request("asset-db", "query-asset-info", params.uuid);
    }
    case "create": {
      // create-asset expects (url: string, content?: string)
      if (!params?.path) {
        throw new Error("assets.create requires { path, content? }");
      }
      return message.request("asset-db", "create-asset", params.path, params.content || null);
    }
    case "import": {
      // import-asset expects (absoluteFilePath: string, targetDbUrl: string)
      if (!params?.filePath || !params?.targetDir) {
        throw new Error("assets.import requires { filePath, targetDir }");
      }
      // Build target url: targetDir + "/" + filename
      const fileName = params.filePath.replace(/\\/g, "/").split("/").pop();
      const targetUrl = params.targetDir.replace(/\/$/, "") + "/" + fileName;
      return message.request("asset-db", "import-asset", params.filePath, targetUrl);
    }
    case "move": {
      // move-asset expects (sourceUrl: string, targetUrl: string)
      // We accept uuid + newPath, resolve uuid to url first
      if (!params?.uuid || !params?.newPath) {
        throw new Error("assets.move requires { uuid, newPath }");
      }
      const sourceUrl = await message.request("asset-db", "query-url", params.uuid);
      if (!sourceUrl) {
        throw new Error(`Cannot resolve URL for asset: ${params.uuid}`);
      }
      return message.request("asset-db", "move-asset", sourceUrl, params.newPath);
    }
    case "rename": {
      // rename-asset expects (oldUrl: string, newUrl: string)
      // We accept uuid + newName, resolve uuid to url and build new url
      if (!params?.uuid || !params?.newName) {
        throw new Error("assets.rename requires { uuid, newName }");
      }
      const oldUrl = await message.request("asset-db", "query-url", params.uuid);
      if (!oldUrl) {
        throw new Error(`Cannot resolve URL for asset: ${params.uuid}`);
      }
      const dir = oldUrl.substring(0, oldUrl.lastIndexOf("/"));
      const newUrl = dir + "/" + params.newName;
      return message.request("asset-db", "rename-asset", oldUrl, newUrl);
    }
    case "delete": {
      // delete-asset expects (url: string)
      if (!params?.uuid) {
        throw new Error("assets.delete requires { uuid }");
      }
      const delUrl = await message.request("asset-db", "query-url", params.uuid);
      if (!delUrl) {
        throw new Error(`Cannot resolve URL for asset: ${params.uuid}`);
      }
      return message.request("asset-db", "delete-asset", delUrl);
    }
    case "getDependencies": {
      // No direct message in Cocos 3.8.x; read meta and return dependency info
      if (!params?.uuid) {
        throw new Error("assets.getDependencies requires { uuid }");
      }
      const meta = await message.request("asset-db", "query-asset-meta", params.uuid);
      if (!meta) {
        throw new Error(`Asset meta not found: ${params.uuid}`);
      }
      // Return the meta which contains dependency information
      return { uuid: params.uuid, meta };
    }
    case "reveal": {
      // Reveal asset in OS file explorer using electron shell
      if (!params?.uuid) {
        throw new Error("assets.reveal requires { uuid }");
      }
      const filePath = await message.request("asset-db", "query-path", params.uuid);
      if (!filePath) {
        throw new Error(`Cannot resolve path for asset: ${params.uuid}`);
      }
      try {
        const electron = process.mainModule!.require("electron");
        electron.shell.showItemInFolder(filePath);
      } catch {
        throw new Error("electron.shell is not available in this environment");
      }
      return { ok: true, path: filePath };
    }
    case "request": {
      // Raw passthrough escape hatch
      if (!params || typeof params.method !== "string") {
        throw new Error("assets.request requires { method, params? }");
      }
      const reqArgs = params.params;
      if (Array.isArray(reqArgs)) {
        return message.request("asset-db", params.method, ...reqArgs);
      }
      if (reqArgs !== undefined && reqArgs !== null && typeof reqArgs === "object") {
        // Convert object values to positional arguments
        return message.request("asset-db", params.method, ...Object.values(reqArgs));
      }
      // Single primitive value or undefined
      if (reqArgs !== undefined) {
        return message.request("asset-db", params.method, reqArgs);
      }
      return message.request("asset-db", params.method);
    }
    default:
      throw new Error(`Unknown assets method: ${method}`);
  }
}

async function editorDispatch(method: string, params?: any): Promise<any> {
  const message = (Editor as any)?.Message;
  if (!message?.request) {
    throw new Error("Editor.Message.request is not available");
  }
  switch (method) {
    case "saveScene":
      return message.request("scene", "save-scene");
    case "queryDirty":
      return message.request("scene", "query-dirty");
    case "openScene":
      if (!params?.uuid) {
        throw new Error("editor.openScene requires { uuid }");
      }
      return message.request("scene", "open-scene", params.uuid);
    case "undo":
      return message.request("scene", "undo");
    case "redo":
      return message.request("scene", "redo");
    case "instantiatePrefab":
      if (!params?.assetUuid) {
        throw new Error("editor.instantiatePrefab requires { assetUuid, parentUuid? }");
      }
      return message.request("scene", "create-node", {
        parent: params.parentUuid || "",
        assetUuid: params.assetUuid,
        type: "cc.Prefab",
      });
    case "createPrefab":
      if (!params?.nodeUuid || !params?.path) {
        throw new Error("editor.createPrefab requires { nodeUuid, path }");
      }
      return message.request("scene", "create-prefab", params.nodeUuid, params.path);
    default:
      throw new Error(`Unknown editor method: ${method}`);
  }
}

function startServer() {
  if (server) {
    return;
  }
  const port = getPort();
  server = net.createServer((socket) => {
    activeSockets.add(socket);
    log("info", `Client connected (${activeSockets.size} active)`);

    socket.on("close", () => {
      activeSockets.delete(socket);
      log("info", `Client disconnected (${activeSockets.size} active)`);
    });

    socket.on("error", (err) => {
      activeSockets.delete(socket);
      log("warn", `Socket error: ${err.message}`);
    });

    let buffer = "";
    socket.on("data", async (data) => {
      buffer += data.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) {
          idx = buffer.indexOf("\n");
          continue;
        }
        let req: MCPRequest | null = null;
        try {
          req = JSON.parse(line);
        } catch (err: any) {
          const errResp: MCPResponse = {
            id: -1,
            error: { message: `Invalid JSON: ${err?.message || err}` },
          };
          socket.write(toLine(errResp));
          idx = buffer.indexOf("\n");
          continue;
        }
        const resp = await handleRequest(req!);
        socket.write(toLine(resp));
        idx = buffer.indexOf("\n");
      }
    });
  });

  server.on("error", (err: any) => {
    log("error", `TCP server error: ${err.message}`);
    if (err.code === "EADDRINUSE") {
      log("error", `Port ${port} is already in use. Set COCOS_MCP_PORT to a different port.`);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    log("info", `TCP server listening on 127.0.0.1:${port}`);
  });
}

function stopServer() {
  if (!server) {
    return;
  }
  for (const socket of activeSockets) {
    socket.destroy();
  }
  activeSockets.clear();
  server.close();
  server = null;
  log("info", "TCP server stopped");
}

module.exports = {
  load() {
    startServer();
  },
  unload() {
    stopServer();
  },
  methods: {
    start() {
      startServer();
    },
    stop() {
      stopServer();
    },
    openPanel() {
      (Editor as any).Panel.open("cocos-mcp");
    },
    queryStatus() {
      return { running: !!server, port: getPort(), clients: activeSockets.size };
    },
  },
};
