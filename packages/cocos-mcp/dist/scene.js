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
function safeSerialize(value, depth = 0) {
    var _a, _b, _c;
    if (depth > 3)
        return "[max depth]";
    if (value === null || value === undefined)
        return value;
    const t = typeof value;
    if (t === "number" || t === "boolean" || t === "string")
        return value;
    if (t === "function")
        return "[function]";
    // Handle Cocos Color
    if (((_a = value.constructor) === null || _a === void 0 ? void 0 : _a.name) === "Color" && typeof value.r === "number") {
        return { r: value.r, g: value.g, b: value.b, a: value.a };
    }
    // Handle Cocos Vec2/Vec3/Vec4
    if (typeof value.x === "number" && typeof value.y === "number") {
        const v = { x: value.x, y: value.y };
        if (typeof value.z === "number")
            v.z = value.z;
        if (typeof value.w === "number")
            v.w = value.w;
        return v;
    }
    // Handle Cocos Size
    if (typeof value.width === "number" && typeof value.height === "number" && Object.keys(value).length <= 3) {
        return { width: value.width, height: value.height };
    }
    // Handle Asset references (Material, Texture, etc.) — avoid circular refs
    if (value._uuid || value.__uuid__) {
        return { uuid: value._uuid || value.__uuid__, name: value.name || null, type: ((_b = value.constructor) === null || _b === void 0 ? void 0 : _b.name) || null };
    }
    // Handle arrays
    if (Array.isArray(value)) {
        return value.map((item) => safeSerialize(item, depth + 1));
    }
    // Handle plain-ish objects — try JSON.stringify as a fast check
    try {
        JSON.stringify(value);
        return value;
    }
    catch {
        // Object has circular refs; extract primitive-valued own properties
        const safe = { _type: ((_c = value.constructor) === null || _c === void 0 ? void 0 : _c.name) || "Object" };
        for (const key of Object.keys(value)) {
            const v = value[key];
            const vt = typeof v;
            if (vt === "number" || vt === "boolean" || vt === "string" || v === null) {
                safe[key] = v;
            }
        }
        return safe;
    }
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
        out[prop] = safeSerialize(comp[prop]);
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
    // Use AsyncFunction so user code can use top-level await.
    // Inject the real cc engine module (require('cc')) instead of globalThis.
    // eslint-disable-next-line no-new-func
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
    const ccModule = require("cc");
    const fn = new AsyncFunction("cc", "args", params.code);
    return fn(ccModule, params.args || []);
}
// ---------------------------------------------------------------------------
// UI convenience methods
// ---------------------------------------------------------------------------
async function createUINode(params) {
    var _a;
    const root = getSceneRoot();
    const parent = params.parentUuid ? findNodeByUuid(root, params.parentUuid) : root;
    if (!parent) {
        throw new Error(`Parent not found: ${params.parentUuid}`);
    }
    const type = params.type;
    const name = params.name || type;
    const props = params.props || {};
    const node = new cc_1.Node(name);
    parent.addChild(node);
    // Every UI node needs UITransform
    const uiTrans = node.addComponent("cc.UITransform");
    if (props.contentSize) {
        uiTrans.setContentSize(new cc_1.Size(props.contentSize[0], props.contentSize[1]));
    }
    const childrenInfo = [];
    switch (type) {
        case "Label": {
            const label = node.addComponent("cc.Label");
            if (props.string !== undefined)
                label.string = props.string;
            if (props.fontSize !== undefined)
                label.fontSize = props.fontSize;
            if (props.color)
                label.color = new cc_1.Color(props.color[0], props.color[1], props.color[2], (_a = props.color[3]) !== null && _a !== void 0 ? _a : 255);
            break;
        }
        case "Sprite": {
            node.addComponent("cc.Sprite");
            break;
        }
        case "Button": {
            if (!props.contentSize)
                uiTrans.setContentSize(new cc_1.Size(160, 60));
            node.addComponent("cc.Sprite");
            node.addComponent("cc.Button");
            // Create child label
            const labelNode = new cc_1.Node("Label");
            node.addChild(labelNode);
            const labelTrans = labelNode.addComponent("cc.UITransform");
            labelTrans.setContentSize(uiTrans.contentSize);
            const label = labelNode.addComponent("cc.Label");
            label.string = props.string || "Button";
            if (props.fontSize !== undefined)
                label.fontSize = props.fontSize;
            childrenInfo.push({ uuid: labelNode.uuid, name: labelNode.name });
            break;
        }
        case "Layout": {
            node.addComponent("cc.Layout");
            break;
        }
        case "ScrollView": {
            if (!props.contentSize)
                uiTrans.setContentSize(new cc_1.Size(200, 300));
            node.addComponent("cc.ScrollView");
            const content = new cc_1.Node("Content");
            node.addChild(content);
            content.addComponent("cc.UITransform");
            childrenInfo.push({ uuid: content.uuid, name: content.name });
            break;
        }
        case "EditBox": {
            if (!props.contentSize)
                uiTrans.setContentSize(new cc_1.Size(200, 40));
            node.addComponent("cc.EditBox");
            break;
        }
        case "Toggle": {
            node.addComponent("cc.Sprite");
            node.addComponent("cc.Toggle");
            break;
        }
        case "Slider": {
            if (!props.contentSize)
                uiTrans.setContentSize(new cc_1.Size(200, 20));
            node.addComponent("cc.Slider");
            break;
        }
        case "ProgressBar": {
            if (!props.contentSize)
                uiTrans.setContentSize(new cc_1.Size(200, 20));
            node.addComponent("cc.ProgressBar");
            break;
        }
        case "RichText": {
            const rt = node.addComponent("cc.RichText");
            if (props.string !== undefined)
                rt.string = props.string;
            break;
        }
        default:
            throw new Error(`Unknown UI type: ${type}. Supported: Label, Sprite, Button, Layout, ScrollView, EditBox, Toggle, Slider, ProgressBar, RichText`);
    }
    return { uuid: node.uuid, name: node.name, type, children: childrenInfo };
}
async function configureWidget(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    let widget = node.getComponent("cc.Widget");
    if (!widget) {
        widget = node.addComponent("cc.Widget");
    }
    const p = params.props || {};
    if (typeof p.isAlignLeft === "boolean")
        widget.isAlignLeft = p.isAlignLeft;
    if (typeof p.left === "number")
        widget.left = p.left;
    if (typeof p.isAlignRight === "boolean")
        widget.isAlignRight = p.isAlignRight;
    if (typeof p.right === "number")
        widget.right = p.right;
    if (typeof p.isAlignTop === "boolean")
        widget.isAlignTop = p.isAlignTop;
    if (typeof p.top === "number")
        widget.top = p.top;
    if (typeof p.isAlignBottom === "boolean")
        widget.isAlignBottom = p.isAlignBottom;
    if (typeof p.bottom === "number")
        widget.bottom = p.bottom;
    if (typeof p.isAlignHorizontalCenter === "boolean")
        widget.isAlignHorizontalCenter = p.isAlignHorizontalCenter;
    if (typeof p.horizontalCenter === "number")
        widget.horizontalCenter = p.horizontalCenter;
    if (typeof p.isAlignVerticalCenter === "boolean")
        widget.isAlignVerticalCenter = p.isAlignVerticalCenter;
    if (typeof p.verticalCenter === "number")
        widget.verticalCenter = p.verticalCenter;
    widget.updateAlignment();
    return { ok: true };
}
async function configureLayout(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    let layout = node.getComponent("cc.Layout");
    if (!layout) {
        layout = node.addComponent("cc.Layout");
    }
    const p = params.props || {};
    if (typeof p.type === "number")
        layout.type = p.type;
    if (typeof p.resizeMode === "number")
        layout.resizeMode = p.resizeMode;
    if (typeof p.spacingX === "number")
        layout.spacingX = p.spacingX;
    if (typeof p.spacingY === "number")
        layout.spacingY = p.spacingY;
    if (typeof p.paddingLeft === "number")
        layout.paddingLeft = p.paddingLeft;
    if (typeof p.paddingRight === "number")
        layout.paddingRight = p.paddingRight;
    if (typeof p.paddingTop === "number")
        layout.paddingTop = p.paddingTop;
    if (typeof p.paddingBottom === "number")
        layout.paddingBottom = p.paddingBottom;
    return { ok: true };
}
// ---------------------------------------------------------------------------
// Animation methods
// ---------------------------------------------------------------------------
async function addAnimation(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    let anim = node.getComponent("cc.Animation");
    if (!anim) {
        anim = node.addComponent("cc.Animation");
    }
    return { uuid: node.uuid, component: "Animation" };
}
async function playAnimation(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const anim = node.getComponent("cc.Animation");
    if (!anim) {
        throw new Error("Node has no Animation component");
    }
    if (params.crossFade !== undefined && params.clipName) {
        anim.crossFade(params.clipName, params.crossFade);
    }
    else if (params.clipName) {
        anim.play(params.clipName);
    }
    else {
        anim.play();
    }
    return { ok: true };
}
async function stopAnimation(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const anim = node.getComponent("cc.Animation");
    if (!anim) {
        throw new Error("Node has no Animation component");
    }
    anim.stop();
    return { ok: true };
}
// ---------------------------------------------------------------------------
// Rendering & Physics methods
// ---------------------------------------------------------------------------
async function setMaterialProperty(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const mr = node.getComponent("cc.MeshRenderer");
    if (!mr) {
        throw new Error("Node has no MeshRenderer component");
    }
    const mat = mr.getMaterialInstance(params.materialIndex || 0);
    if (!mat) {
        throw new Error(`Material not found at index ${params.materialIndex || 0}`);
    }
    // Handle color values passed as [r,g,b,a]
    let val = params.value;
    if (Array.isArray(val) && val.length === 4 && typeof val[0] === "number") {
        val = new cc_1.Color(val[0], val[1], val[2], val[3]);
    }
    mat.setProperty(params.propName, val);
    return { ok: true };
}
async function getMaterialProperty(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const mr = node.getComponent("cc.MeshRenderer");
    if (!mr) {
        throw new Error("Node has no MeshRenderer component");
    }
    const mat = mr.getMaterialInstance(params.materialIndex || 0);
    if (!mat) {
        throw new Error(`Material not found at index ${params.materialIndex || 0}`);
    }
    const val = mat.getProperty(params.propName);
    return { propName: params.propName, value: val };
}
async function addPhysicsBody(params) {
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    // Add RigidBody if not present
    let rb = node.getComponent("cc.RigidBody");
    if (!rb) {
        rb = node.addComponent("cc.RigidBody");
    }
    // Set body type: 1=DYNAMIC, 2=STATIC, 4=KINEMATIC
    const typeMap = { dynamic: 1, static: 2, kinematic: 4 };
    const bt = params.bodyType || "dynamic";
    if (typeMap[bt] !== undefined) {
        rb.type = typeMap[bt];
    }
    // Add collider
    const colliderMap = {
        box: "cc.BoxCollider",
        sphere: "cc.SphereCollider",
        capsule: "cc.CapsuleCollider",
        cylinder: "cc.CylinderCollider",
        mesh: "cc.MeshCollider",
    };
    const colliderClass = colliderMap[params.colliderType];
    if (!colliderClass) {
        throw new Error(`Unknown collider type: ${params.colliderType}. Supported: box, sphere, capsule, cylinder, mesh`);
    }
    const collider = node.addComponent(colliderClass);
    // Apply collider params
    const cp = params.colliderParams || {};
    if (cp.size && collider.size) {
        collider.size = new cc_1.Vec3(cp.size[0], cp.size[1], cp.size[2]);
    }
    if (typeof cp.radius === "number" && "radius" in collider) {
        collider.radius = cp.radius;
    }
    if (typeof cp.height === "number" && "height" in collider) {
        collider.height = cp.height;
    }
    if (cp.center) {
        collider.center = new cc_1.Vec3(cp.center[0], cp.center[1], cp.center[2]);
    }
    if (typeof cp.isTrigger === "boolean") {
        collider.isTrigger = cp.isTrigger;
    }
    return { uuid: node.uuid, rigidBody: "RigidBody", collider: params.colliderType };
}
async function configureParticleSystem(params) {
    var _a;
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    let ps = node.getComponent("cc.ParticleSystem");
    if (!ps) {
        ps = node.addComponent("cc.ParticleSystem");
    }
    const p = params.props || {};
    if (typeof p.duration === "number")
        ps.duration = p.duration;
    if (typeof p.loop === "boolean")
        ps.loop = p.loop;
    if (typeof p.playOnAwake === "boolean")
        ps.playOnAwake = p.playOnAwake;
    if (typeof p.capacity === "number")
        ps.capacity = p.capacity;
    // CurveRange properties use .constant
    if (typeof p.startLifetime === "number")
        ps.startLifetime.constant = p.startLifetime;
    if (typeof p.startSpeed === "number")
        ps.startSpeed.constant = p.startSpeed;
    if (typeof p.startSize === "number") {
        ps.startSize3D = false;
        ps.startSizeX.constant = p.startSize;
    }
    if (p.startColor)
        ps.startColor.constant = new cc_1.Color(p.startColor[0], p.startColor[1], p.startColor[2], (_a = p.startColor[3]) !== null && _a !== void 0 ? _a : 255);
    if (typeof p.gravityModifier === "number")
        ps.gravityModifier.constant = p.gravityModifier;
    if (typeof p.rateOverTime === "number")
        ps.rateOverTime.constant = p.rateOverTime;
    if (p.play === true)
        ps.play();
    return { ok: true };
}
// ---------------------------------------------------------------------------
// Prefab methods
// ---------------------------------------------------------------------------
async function getPrefabInfo(params) {
    var _a, _b, _c;
    const root = getSceneRoot();
    const node = findNodeByUuid(root, params.uuid);
    if (!node) {
        throw new Error(`Node not found: ${params.uuid}`);
    }
    const prefab = node._prefab;
    if (!prefab) {
        return { isPrefab: false };
    }
    return {
        isPrefab: true,
        fileId: prefab.fileId || null,
        assetUuid: ((_a = prefab.asset) === null || _a === void 0 ? void 0 : _a._uuid) || ((_b = prefab.asset) === null || _b === void 0 ? void 0 : _b.uuid) || null,
        rootUuid: ((_c = prefab.root) === null || _c === void 0 ? void 0 : _c.uuid) || null,
    };
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
        // UI
        createUINode,
        configureWidget,
        configureLayout,
        // Animation
        addAnimation,
        playAnimation,
        stopAnimation,
        // Rendering & Physics
        setMaterialProperty,
        getMaterialProperty,
        addPhysicsBody,
        configureParticleSystem,
        // Prefab
        getPrefabInfo,
    },
};
//# sourceMappingURL=scene.js.map