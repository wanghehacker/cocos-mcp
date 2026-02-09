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
    // eslint-disable-next-line no-new-func
    const fn = new Function("Editor", "args", params.code);
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
  const assetdb = (Editor as any)?.AssetDB || (Editor as any)?.assetdb;

  if (method === "request") {
    if (!params || typeof params.method !== "string") {
      throw new Error("assets.request requires { method, params? }");
    }
    return requestAssetDB(message, assetdb, params.method, params.params);
  }

  const mapping: Record<string, { msg: string; fn?: string }> = {
    find: { msg: "query-assets", fn: "queryAssets" },
    getInfo: { msg: "query-asset-info", fn: "queryAssetInfo" },
    create: { msg: "create-asset", fn: "createAsset" },
    import: { msg: "import-asset", fn: "importAsset" },
    move: { msg: "move-asset", fn: "moveAsset" },
    rename: { msg: "rename-asset", fn: "renameAsset" },
    delete: { msg: "delete-asset", fn: "deleteAsset" },
    getDependencies: { msg: "query-deps", fn: "queryDeps" },
    reveal: { msg: "reveal-in-explorer", fn: "revealInExplorer" },
  };

  const entry = mapping[method];
  if (!entry) {
    return requestAssetDB(message, assetdb, method, params);
  }
  return requestAssetDB(message, assetdb, entry.msg, params, entry.fn);
}

async function requestAssetDB(
  message: any,
  assetdb: any,
  method: string,
  params?: any,
  fnName?: string
): Promise<any> {
  let lastErr: any = null;
  if (message?.request) {
    try {
      return await message.request("asset-db", method, params);
    } catch (err: any) {
      lastErr = err;
    }
  }
  if (assetdb && fnName && typeof assetdb[fnName] === "function") {
    return assetdb[fnName](params);
  }
  if (assetdb && typeof assetdb[method] === "function") {
    return assetdb[method](params);
  }
  if (lastErr) {
    throw lastErr;
  }
  throw new Error("AssetDB API not available");
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
    status() {
      return { running: !!server, port: getPort(), clients: activeSockets.size };
    },
  },
};
