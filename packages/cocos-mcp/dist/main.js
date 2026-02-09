"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const DEFAULT_PORT = 8787;
let server = null;
const activeSockets = new Set();
function log(level, msg) {
    const prefix = "[cocos-mcp]";
    console[level](`${prefix} ${msg}`);
}
function getPort() {
    var _a;
    const envPort = process.env.COCOS_MCP_PORT;
    if (envPort && Number.isFinite(Number(envPort))) {
        return Number(envPort);
    }
    try {
        const profileGet = (_a = Editor === null || Editor === void 0 ? void 0 : Editor.Profile) === null || _a === void 0 ? void 0 : _a.getProject;
        if (profileGet) {
            const port = profileGet("cocos-mcp", "port");
            if (Number.isFinite(Number(port))) {
                return Number(port);
            }
        }
    }
    catch {
        // Ignore profile errors and fall back to default.
    }
    return DEFAULT_PORT;
}
function toLine(obj) {
    return `${JSON.stringify(obj)}\n`;
}
async function handleRequest(req) {
    log("info", `<-- ${req.method} (id=${req.id})`);
    try {
        const result = await dispatch(req.method, req.params);
        log("info", `--> ${req.method} OK (id=${req.id})`);
        return { id: req.id, result };
    }
    catch (err) {
        log("warn", `--> ${req.method} ERROR: ${err === null || err === void 0 ? void 0 : err.message} (id=${req.id})`);
        return {
            id: req.id,
            error: { message: (err === null || err === void 0 ? void 0 : err.message) || String(err) },
        };
    }
}
async function dispatch(method, params) {
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
async function execute(params) {
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
async function sceneDispatch(method, params) {
    const message = Editor === null || Editor === void 0 ? void 0 : Editor.Message;
    if (!(message === null || message === void 0 ? void 0 : message.request)) {
        throw new Error("Editor.Message.request is not available");
    }
    return message.request("scene", "execute-scene-script", {
        name: "cocos-mcp",
        method,
        args: Array.isArray(params) ? params : params !== undefined ? [params] : [],
    });
}
async function assetsDispatch(method, params) {
    const message = Editor === null || Editor === void 0 ? void 0 : Editor.Message;
    const assetdb = (Editor === null || Editor === void 0 ? void 0 : Editor.AssetDB) || (Editor === null || Editor === void 0 ? void 0 : Editor.assetdb);
    if (method === "request") {
        if (!params || typeof params.method !== "string") {
            throw new Error("assets.request requires { method, params? }");
        }
        return requestAssetDB(message, assetdb, params.method, params.params);
    }
    const mapping = {
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
async function requestAssetDB(message, assetdb, method, params, fnName) {
    let lastErr = null;
    if (message === null || message === void 0 ? void 0 : message.request) {
        try {
            return await message.request("asset-db", method, params);
        }
        catch (err) {
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
async function editorDispatch(method, params) {
    const message = Editor === null || Editor === void 0 ? void 0 : Editor.Message;
    if (!(message === null || message === void 0 ? void 0 : message.request)) {
        throw new Error("Editor.Message.request is not available");
    }
    switch (method) {
        case "saveScene":
            return message.request("scene", "save-scene");
        case "queryDirty":
            return message.request("scene", "query-dirty");
        case "openScene":
            if (!(params === null || params === void 0 ? void 0 : params.uuid)) {
                throw new Error("editor.openScene requires { uuid }");
            }
            return message.request("scene", "open-scene", params.uuid);
        case "undo":
            return message.request("scene", "undo");
        case "redo":
            return message.request("scene", "redo");
        case "instantiatePrefab":
            if (!(params === null || params === void 0 ? void 0 : params.assetUuid)) {
                throw new Error("editor.instantiatePrefab requires { assetUuid, parentUuid? }");
            }
            return message.request("scene", "create-node", {
                parent: params.parentUuid || "",
                assetUuid: params.assetUuid,
                type: "cc.Prefab",
            });
        case "createPrefab":
            if (!(params === null || params === void 0 ? void 0 : params.nodeUuid) || !(params === null || params === void 0 ? void 0 : params.path)) {
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
    server = net_1.default.createServer((socket) => {
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
                let req = null;
                try {
                    req = JSON.parse(line);
                }
                catch (err) {
                    const errResp = {
                        id: -1,
                        error: { message: `Invalid JSON: ${(err === null || err === void 0 ? void 0 : err.message) || err}` },
                    };
                    socket.write(toLine(errResp));
                    idx = buffer.indexOf("\n");
                    continue;
                }
                const resp = await handleRequest(req);
                socket.write(toLine(resp));
                idx = buffer.indexOf("\n");
            }
        });
    });
    server.on("error", (err) => {
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
//# sourceMappingURL=main.js.map