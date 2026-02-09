import { director, Node, instantiate, Vec3 } from "cc";

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
