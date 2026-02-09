import { director, Node, instantiate, Vec3, Color, Size } from "cc";

type NodeInfo = {
  uuid: string;
  name: string;
  path: string;
  active: boolean;
  children: NodeInfo[];
};

function buildNodeInfo(node: Node, path: string): NodeInfo {
  const nextPath = path ? `${path}/${node.name}` : node.name;
  return {
    uuid: node.uuid,
    name: node.name,
    path: nextPath,
    active: node.active,
    children: node.children.map((child) => buildNodeInfo(child, nextPath)),
  };
}

function findNodeByUuid(root: Node, uuid: string): Node | null {
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

function getSceneRoot(): Node {
  const scene = director.getScene();
  if (!scene) {
    throw new Error("No active scene");
  }
  return scene;
}

async function getActive() {
  const scene = getSceneRoot();
  return { name: scene.name, uuid: scene.uuid };
}

async function listNodes(params?: { rootUuid?: string }) {
  const root = getSceneRoot();
  const target = params?.rootUuid ? findNodeByUuid(root, params.rootUuid) : root;
  if (!target) {
    throw new Error(`Node not found: ${params?.rootUuid}`);
  }
  return buildNodeInfo(target, "");
}

async function createNode(params: { parentUuid?: string; name: string }) {
  const root = getSceneRoot();
  const parent = params.parentUuid ? findNodeByUuid(root, params.parentUuid) : root;
  if (!parent) {
    throw new Error(`Parent not found: ${params.parentUuid}`);
  }
  const node = new Node(params.name);
  parent.addChild(node);
  return { uuid: node.uuid, name: node.name, parentUuid: parent.uuid };
}

async function deleteNode(params: { uuid: string }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  node.destroy();
  return { ok: true };
}

async function duplicateNode(params: { uuid: string; parentUuid?: string }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const parent = params.parentUuid ? findNodeByUuid(root, params.parentUuid) : node.parent;
  if (!parent) {
    throw new Error("Parent not found");
  }
  const clone = instantiate(node);
  parent.addChild(clone);
  return { uuid: clone.uuid, name: clone.name, parentUuid: parent.uuid };
}

async function moveNode(params: { uuid: string; newParentUuid: string; siblingIndex?: number }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  const parent = findNodeByUuid(root, params.newParentUuid);
  if (!node || !parent) {
    throw new Error("Node or parent not found");
  }
  node.parent = parent;
  if (Number.isFinite(params.siblingIndex)) {
    node.setSiblingIndex(params.siblingIndex as number);
  }
  return { ok: true };
}

async function getNodeProps(params: { uuid: string; props: string[] }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const out: Record<string, any> = {};
  for (const prop of params.props || []) {
    if (prop === "position") {
      const p = node.position;
      out.position = [p.x, p.y, p.z];
    } else if (prop === "rotation") {
      const r = node.eulerAngles;
      out.rotation = [r.x, r.y, r.z];
    } else if (prop === "scale") {
      const s = node.scale;
      out.scale = [s.x, s.y, s.z];
    } else if (prop === "active") {
      out.active = node.active;
    } else if (prop === "name") {
      out.name = node.name;
    } else if (prop === "layer") {
      out.layer = node.layer;
    } else if (prop === "parentUuid") {
      out.parentUuid = node.parent?.uuid || null;
    }
  }
  return out;
}

async function setNodeProps(params: { uuid: string; props: Record<string, any> }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const props = params.props || {};
  if (props.position) {
    const [x, y, z] = props.position;
    node.setPosition(new Vec3(x, y, z));
  }
  if (props.rotation) {
    const [x, y, z] = props.rotation;
    node.setRotationFromEuler(x, y, z);
  }
  if (props.scale) {
    const [x, y, z] = props.scale;
    node.setScale(new Vec3(x, y, z));
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

async function addComponent(params: { uuid: string; type: string }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const comp = node.addComponent(params.type as any);
  return { uuid: node.uuid, component: comp?.name || params.type };
}

async function removeComponent(params: { uuid: string; type: string }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const comp = node.getComponent(params.type as any);
  if (comp) {
    node.removeComponent(comp);
  }
  return { ok: true };
}

async function getComponentProps(params: { uuid: string; type: string; props: string[] }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const comp = node.getComponent(params.type as any) as any;
  if (!comp) {
    throw new Error(`Component not found: ${params.type}`);
  }
  const out: Record<string, any> = {};
  for (const prop of params.props || []) {
    out[prop] = comp[prop];
  }
  return out;
}

async function setComponentProps(params: { uuid: string; type: string; props: Record<string, any> }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const comp = node.getComponent(params.type as any) as any;
  if (!comp) {
    throw new Error(`Component not found: ${params.type}`);
  }
  const props = params.props || {};
  for (const key of Object.keys(props)) {
    comp[key] = props[key];
  }
  return { ok: true };
}

async function execute(params: { code: string; args?: any[] }) {
  if (!params || typeof params.code !== "string") {
    throw new Error("execute requires { code, args? }");
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function("cc", "args", params.code);
  return fn(globalThis as any, params.args || []);
}

// ---------------------------------------------------------------------------
// UI convenience methods
// ---------------------------------------------------------------------------

async function createUINode(params: {
  type: string;
  parentUuid?: string;
  name?: string;
  props?: Record<string, any>;
}) {
  const root = getSceneRoot();
  const parent = params.parentUuid ? findNodeByUuid(root, params.parentUuid) : root;
  if (!parent) {
    throw new Error(`Parent not found: ${params.parentUuid}`);
  }

  const type = params.type;
  const name = params.name || type;
  const props = params.props || {};
  const node = new Node(name);
  parent.addChild(node);

  // Every UI node needs UITransform
  const uiTrans = node.addComponent("cc.UITransform") as any;
  if (props.contentSize) {
    uiTrans.setContentSize(new Size(props.contentSize[0], props.contentSize[1]));
  }

  const childrenInfo: { uuid: string; name: string }[] = [];

  switch (type) {
    case "Label": {
      const label = node.addComponent("cc.Label") as any;
      if (props.string !== undefined) label.string = props.string;
      if (props.fontSize !== undefined) label.fontSize = props.fontSize;
      if (props.color) label.color = new Color(props.color[0], props.color[1], props.color[2], props.color[3] ?? 255);
      break;
    }
    case "Sprite": {
      node.addComponent("cc.Sprite");
      break;
    }
    case "Button": {
      if (!props.contentSize) uiTrans.setContentSize(new Size(160, 60));
      node.addComponent("cc.Sprite");
      node.addComponent("cc.Button");
      // Create child label
      const labelNode = new Node("Label");
      node.addChild(labelNode);
      const labelTrans = labelNode.addComponent("cc.UITransform") as any;
      labelTrans.setContentSize(uiTrans.contentSize);
      const label = labelNode.addComponent("cc.Label") as any;
      label.string = props.string || "Button";
      if (props.fontSize !== undefined) label.fontSize = props.fontSize;
      childrenInfo.push({ uuid: labelNode.uuid, name: labelNode.name });
      break;
    }
    case "Layout": {
      node.addComponent("cc.Layout");
      break;
    }
    case "ScrollView": {
      if (!props.contentSize) uiTrans.setContentSize(new Size(200, 300));
      node.addComponent("cc.ScrollView");
      const content = new Node("Content");
      node.addChild(content);
      content.addComponent("cc.UITransform");
      childrenInfo.push({ uuid: content.uuid, name: content.name });
      break;
    }
    case "EditBox": {
      if (!props.contentSize) uiTrans.setContentSize(new Size(200, 40));
      node.addComponent("cc.EditBox");
      break;
    }
    case "Toggle": {
      node.addComponent("cc.Sprite");
      node.addComponent("cc.Toggle");
      break;
    }
    case "Slider": {
      if (!props.contentSize) uiTrans.setContentSize(new Size(200, 20));
      node.addComponent("cc.Slider");
      break;
    }
    case "ProgressBar": {
      if (!props.contentSize) uiTrans.setContentSize(new Size(200, 20));
      node.addComponent("cc.ProgressBar");
      break;
    }
    case "RichText": {
      const rt = node.addComponent("cc.RichText") as any;
      if (props.string !== undefined) rt.string = props.string;
      break;
    }
    default:
      throw new Error(`Unknown UI type: ${type}. Supported: Label, Sprite, Button, Layout, ScrollView, EditBox, Toggle, Slider, ProgressBar, RichText`);
  }

  return { uuid: node.uuid, name: node.name, type, children: childrenInfo };
}

async function configureWidget(params: { uuid: string; props: Record<string, any> }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  let widget = node.getComponent("cc.Widget") as any;
  if (!widget) {
    widget = node.addComponent("cc.Widget") as any;
  }
  const p = params.props || {};
  if (typeof p.isAlignLeft === "boolean") widget.isAlignLeft = p.isAlignLeft;
  if (typeof p.left === "number") widget.left = p.left;
  if (typeof p.isAlignRight === "boolean") widget.isAlignRight = p.isAlignRight;
  if (typeof p.right === "number") widget.right = p.right;
  if (typeof p.isAlignTop === "boolean") widget.isAlignTop = p.isAlignTop;
  if (typeof p.top === "number") widget.top = p.top;
  if (typeof p.isAlignBottom === "boolean") widget.isAlignBottom = p.isAlignBottom;
  if (typeof p.bottom === "number") widget.bottom = p.bottom;
  if (typeof p.isAlignHorizontalCenter === "boolean") widget.isAlignHorizontalCenter = p.isAlignHorizontalCenter;
  if (typeof p.horizontalCenter === "number") widget.horizontalCenter = p.horizontalCenter;
  if (typeof p.isAlignVerticalCenter === "boolean") widget.isAlignVerticalCenter = p.isAlignVerticalCenter;
  if (typeof p.verticalCenter === "number") widget.verticalCenter = p.verticalCenter;
  widget.updateAlignment();
  return { ok: true };
}

async function configureLayout(params: { uuid: string; props: Record<string, any> }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  let layout = node.getComponent("cc.Layout") as any;
  if (!layout) {
    layout = node.addComponent("cc.Layout") as any;
  }
  const p = params.props || {};
  if (typeof p.type === "number") layout.type = p.type;
  if (typeof p.resizeMode === "number") layout.resizeMode = p.resizeMode;
  if (typeof p.spacingX === "number") layout.spacingX = p.spacingX;
  if (typeof p.spacingY === "number") layout.spacingY = p.spacingY;
  if (typeof p.paddingLeft === "number") layout.paddingLeft = p.paddingLeft;
  if (typeof p.paddingRight === "number") layout.paddingRight = p.paddingRight;
  if (typeof p.paddingTop === "number") layout.paddingTop = p.paddingTop;
  if (typeof p.paddingBottom === "number") layout.paddingBottom = p.paddingBottom;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Animation methods
// ---------------------------------------------------------------------------

async function addAnimation(params: { uuid: string }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  let anim = node.getComponent("cc.Animation") as any;
  if (!anim) {
    anim = node.addComponent("cc.Animation") as any;
  }
  return { uuid: node.uuid, component: "Animation" };
}

async function playAnimation(params: { uuid: string; clipName?: string; crossFade?: number }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const anim = node.getComponent("cc.Animation") as any;
  if (!anim) {
    throw new Error("Node has no Animation component");
  }
  if (params.crossFade !== undefined && params.clipName) {
    anim.crossFade(params.clipName, params.crossFade);
  } else if (params.clipName) {
    anim.play(params.clipName);
  } else {
    anim.play();
  }
  return { ok: true };
}

async function stopAnimation(params: { uuid: string }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const anim = node.getComponent("cc.Animation") as any;
  if (!anim) {
    throw new Error("Node has no Animation component");
  }
  anim.stop();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rendering & Physics methods
// ---------------------------------------------------------------------------

async function setMaterialProperty(params: {
  uuid: string;
  materialIndex?: number;
  propName: string;
  value: any;
}) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const mr = node.getComponent("cc.MeshRenderer") as any;
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
    val = new Color(val[0], val[1], val[2], val[3]);
  }
  mat.setProperty(params.propName, val);
  return { ok: true };
}

async function getMaterialProperty(params: {
  uuid: string;
  materialIndex?: number;
  propName: string;
}) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  const mr = node.getComponent("cc.MeshRenderer") as any;
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

async function addPhysicsBody(params: {
  uuid: string;
  bodyType?: string;
  colliderType: string;
  colliderParams?: Record<string, any>;
}) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }

  // Add RigidBody if not present
  let rb = node.getComponent("cc.RigidBody") as any;
  if (!rb) {
    rb = node.addComponent("cc.RigidBody") as any;
  }
  // Set body type: 1=DYNAMIC, 2=STATIC, 4=KINEMATIC
  const typeMap: Record<string, number> = { dynamic: 1, static: 2, kinematic: 4 };
  const bt = params.bodyType || "dynamic";
  if (typeMap[bt] !== undefined) {
    rb.type = typeMap[bt];
  }

  // Add collider
  const colliderMap: Record<string, string> = {
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
  const collider = node.addComponent(colliderClass as any) as any;

  // Apply collider params
  const cp = params.colliderParams || {};
  if (cp.size && collider.size) {
    collider.size = new Vec3(cp.size[0], cp.size[1], cp.size[2]);
  }
  if (typeof cp.radius === "number" && "radius" in collider) {
    collider.radius = cp.radius;
  }
  if (typeof cp.height === "number" && "height" in collider) {
    collider.height = cp.height;
  }
  if (cp.center) {
    collider.center = new Vec3(cp.center[0], cp.center[1], cp.center[2]);
  }
  if (typeof cp.isTrigger === "boolean") {
    collider.isTrigger = cp.isTrigger;
  }

  return { uuid: node.uuid, rigidBody: "RigidBody", collider: params.colliderType };
}

async function configureParticleSystem(params: { uuid: string; props: Record<string, any> }) {
  const root = getSceneRoot();
  const node = findNodeByUuid(root, params.uuid);
  if (!node) {
    throw new Error(`Node not found: ${params.uuid}`);
  }
  let ps = node.getComponent("cc.ParticleSystem") as any;
  if (!ps) {
    ps = node.addComponent("cc.ParticleSystem") as any;
  }
  const p = params.props || {};
  if (typeof p.duration === "number") ps.duration = p.duration;
  if (typeof p.loop === "boolean") ps.loop = p.loop;
  if (typeof p.playOnAwake === "boolean") ps.playOnAwake = p.playOnAwake;
  if (typeof p.capacity === "number") ps.capacity = p.capacity;
  // CurveRange properties use .constant
  if (typeof p.startLifetime === "number") ps.startLifetime.constant = p.startLifetime;
  if (typeof p.startSpeed === "number") ps.startSpeed.constant = p.startSpeed;
  if (typeof p.startSize === "number") { ps.startSize3D = false; ps.startSizeX.constant = p.startSize; }
  if (p.startColor) ps.startColor.constant = new Color(p.startColor[0], p.startColor[1], p.startColor[2], p.startColor[3] ?? 255);
  if (typeof p.gravityModifier === "number") ps.gravityModifier.constant = p.gravityModifier;
  if (typeof p.rateOverTime === "number") ps.rateOverTime.constant = p.rateOverTime;
  if (p.play === true) ps.play();
  return { ok: true };
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
  },
};
