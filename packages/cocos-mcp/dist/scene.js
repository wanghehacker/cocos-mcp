"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cc_1 = require("cc");
function buildNodeInfo(node, path) {
    const nextPath = path ? `${path}/${node.name}` : node.name;
    return {
        uuid: node.uuid,
        name: node.name,
        path: nextPath,
        active: node.active,
        children: node.children.map((child) => buildNodeInfo(child, nextPath)),
    };
}
function findNodeByUuid(root, uuid) {
    if (root.uuid === uuid) {
        return root;
    }
    for (const child of root.children) {
        const found = findNodeByUuid(child, uuid);
        if (found) {
            return found;
        }
    }
    return null;
}
function getSceneRoot() {
    const scene = cc_1.director.getScene();
    if (!scene) {
        throw new Error("No active scene");
    }
    return scene;
}
async function getActive() {
    const scene = getSceneRoot();
    return { name: scene.name, uuid: scene.uuid };
}
async function listNodes(params) {
    const root = getSceneRoot();
    const target = (params === null || params === void 0 ? void 0 : params.rootUuid) ? findNodeByUuid(root, params.rootUuid) : root;
    if (!target) {
        throw new Error(`Node not found: ${params === null || params === void 0 ? void 0 : params.rootUuid}`);
    }
    return buildNodeInfo(target, "");
}
async function createNode(params) {
    const root = getSceneRoot();
    const parent = params.parentUuid ? findNodeByUuid(root, params.parentUuid) : root;
    if (!parent) {
        throw new Error(`Parent not found: ${params.parentUuid}`);
    }
    const node = new cc_1.Node(params.name);
    parent.addChild(node);
    return { uuid: node.uuid, name: node.name, parentUuid: parent.uuid };
}
async function deleteNode(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    node.destroy();
    return { ok: true };
}
async function duplicateNode(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const parent = params.parentUuid ? findNodeByUuid(root, params.parentUuid) : node.parent;
    if (!parent) {
        throw new Error("Parent not found");
    }
    const clone = (0, cc_1.instantiate)(node);
    parent.addChild(clone);
    return { uuid: clone.uuid, name: clone.name, parentUuid: parent.uuid };
}
async function moveNode(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    const parent = findNodeByUuid(root, params.newParentUuid);
    if (!node || !parent) {
        throw new Error("Node or parent not found");
    }
    node.parent = parent;
    if (Number.isFinite(params.siblingIndex)) {
        node.setSiblingIndex(params.siblingIndex);
    }
    return { ok: true };
}
async function getNodeProps(params) {
    var _a;
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const out = {};
    for (const prop of params.props || []) {
        if (prop === "position") {
            const p = node.position;
            out.position = [p.x, p.y, p.z];
        }
        else if (prop === "rotation") {
            const r = node.eulerAngles;
            out.rotation = [r.x, r.y, r.z];
        }
        else if (prop === "scale") {
            const s = node.scale;
            out.scale = [s.x, s.y, s.z];
        }
        else if (prop === "active") {
            out.active = node.active;
        }
        else if (prop === "name") {
            out.name = node.name;
        }
        else if (prop === "layer") {
            out.layer = node.layer;
        }
        else if (prop === "parentUuid") {
            out.parentUuid = ((_a = node.parent) === null || _a === void 0 ? void 0 : _a.uuid) || null;
        }
    }
    return out;
}
async function setNodeProps(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const props = params.props || {};
    if (props.position) {
        const [x, y, z] = props.position;
        node.setPosition(new cc_1.Vec3(x, y, z));
    }
    if (props.rotation) {
        const [x, y, z] = props.rotation;
        node.setRotationFromEuler(x, y, z);
    }
    if (props.scale) {
        const [x, y, z] = props.scale;
        node.setScale(new cc_1.Vec3(x, y, z));
    }
    if (typeof props.active === "boolean") {
        node.active = props.active;
    }
    if (typeof props.name === "string") {
        node.name = props.name;
    }
    if (typeof props.layer === "number") {
        node.layer = props.layer;
    }
    return { ok: true };
}
async function addComponent(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const comp = node.addComponent(params.type);
    return { uuid: node.uuid, component: (comp === null || comp === void 0 ? void 0 : comp.name) || params.type };
}
async function removeComponent(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const comp = node.getComponent(params.type);
    if (comp) {
        node.removeComponent(comp);
    }
    return { ok: true };
}
async function getComponentProps(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const comp = node.getComponent(params.type);
    if (!comp) {
        throw new Error(`Component not found: ${params.type}`);
    }
    const out = {};
    for (const prop of params.props || []) {
        out[prop] = comp[prop];
    }
    return out;
}
async function setComponentProps(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const comp = node.getComponent(params.type);
    if (!comp) {
        throw new Error(`Component not found: ${params.type}`);
    }
    const props = params.props || {};
    for (const key of Object.keys(props)) {
        comp[key] = props[key];
    }
    return { ok: true };
}
async function execute(params) {
    if (!params || typeof params.code !== "string") {
        throw new Error("execute requires { code, args? }");
    }
    // eslint-disable-next-line no-new-func
    const fn = new Function("cc", "args", params.code);
    return fn(globalThis, params.args || []);
}
function load() {
    // Scene script loaded
}
function unload() {
    // Scene script unloaded
}
module.exports = {
    load,
    unload,
    methods: {
        getActive,
        listNodes,
        createNode,
        deleteNode,
        duplicateNode,
        moveNode,
        getNodeProps,
        setNodeProps,
        addComponent,
        removeComponent,
        getComponentProps,
        setComponentProps,
        execute,
    },
};
//# sourceMappingURL=scene.js.map