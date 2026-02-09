// Minimal type stubs for Cocos Creator 3.8.x editor extension environment.
// These allow TypeScript compilation outside the editor. The real types are
// provided by the Cocos Creator runtime at load time.

declare const Editor: any;

declare module "cc" {
  export const director: any;
  export class Node {
    uuid: string;
    name: string;
    active: boolean;
    layer: number;
    parent: Node | null;
    children: Node[];
    position: { x: number; y: number; z: number };
    eulerAngles: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    constructor(name?: string);
    addChild(node: Node): void;
    destroy(): void;
    setSiblingIndex(index: number): void;
    setPosition(pos: any): void;
    setRotationFromEuler(x: number, y: number, z: number): void;
    setScale(scale: any): void;
    addComponent(type: any): any;
    removeComponent(comp: any): void;
    getComponent(type: any): any;
  }
  export class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
  }
  export class Color {
    r: number;
    g: number;
    b: number;
    a: number;
    constructor(r?: number, g?: number, b?: number, a?: number);
  }
  export class Size {
    width: number;
    height: number;
    constructor(width?: number, height?: number);
  }
  export function instantiate(original: any): any;
}
