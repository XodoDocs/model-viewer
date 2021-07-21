/* eslint-disable */

/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ACESFilmicToneMapping, BackSide, BoxGeometry, BufferGeometry, Color, DoubleSide, EdgesGeometry, Event, EventDispatcher, GammaEncoding, Group, Line, Line3, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshNormalMaterial, MeshPhongMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap, PlaneGeometry, Ray, Raycaster, SphereGeometry, Vector2, Vector3, WebGL1Renderer, WireframeGeometry} from 'three';
import {acceleratedRaycast, MeshBVH} from 'three-mesh-bvh';
import {VertexNormalsHelper} from 'three/examples/jsm/helpers/VertexNormalsHelper.js';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {RoughnessMipmapper} from 'three/examples/jsm/utils/RoughnessMipmapper';

import {USE_OFFSCREEN_CANVAS} from '../constants.js';
import {$canvas, $sceneIsReady, $tick, $updateSize, $userInputElement} from '../model-viewer-base.js';
import {clamp, isDebugMode, resolveDpr} from '../utilities.js';

import {ARRenderer} from './ARRenderer.js';
import {CachingGLTFLoader} from './CachingGLTFLoader.js';
import {Debugger} from './Debugger.js';
import {ModelViewerGLTFInstance} from './gltf-instance/ModelViewerGLTFInstance.js';
import {ModelScene} from './ModelScene.js';
import TextureUtils from './TextureUtils.js';

// import {VertexNormalsHelper} from './VertexNormalsHelper.js'; // modified to
// work with child

export interface RendererOptions {
  debug?: boolean;
}

export interface ContextLostEvent extends Event {
  type: 'contextlost';
  sourceEvent: WebGLContextEvent;
}

// Between 0 and 1: larger means the average responds faster and is less smooth.
const DURATION_DECAY = 0.2;
const LOW_FRAME_DURATION_MS = 18;
const HIGH_FRAME_DURATION_MS = 26;
const MAX_AVG_CHANGE_MS = 2;
const SCALE_STEPS = [1, 0.79, 0.62, 0.5, 0.4, 0.31, 0.25];
const DEFAULT_LAST_STEP = 3;

const raycaster = new Raycaster();

/**
 * Registers canvases with Canvas2DRenderingContexts and renders them
 * all in the same WebGLRenderingContext, spitting out textures to apply
 * to the canvases. Creates a fullscreen WebGL canvas that is not added
 * to the DOM, and on each frame, renders each registered canvas on a portion
 * of the WebGL canvas, and applies the texture on the registered canvas.
 *
 * In the future, can use ImageBitmapRenderingContext instead of
 * Canvas2DRenderingContext if supported for cheaper transfering of
 * the texture.
 */
export class Renderer extends EventDispatcher {
  static _singleton = new Renderer({debug: isDebugMode()});

  static get singleton() {
    return this._singleton;
  }

  static resetSingleton() {
    this._singleton.dispose();
    this._singleton = new Renderer({debug: isDebugMode()});
  }

  public threeRenderer!: WebGL1Renderer;
  public canvasElement: HTMLCanvasElement;
  public canvas3D: HTMLCanvasElement|OffscreenCanvas;
  public textureUtils: TextureUtils|null;
  public arRenderer: ARRenderer;
  public roughnessMipmapper: RoughnessMipmapper;
  public loader = new CachingGLTFLoader(ModelViewerGLTFInstance);
  public width = 0;
  public height = 0;
  public dpr = 1;

  private foo = [];
  private bvhs = [];
  private edgeLines = [];

  public isWireframe = false;
  public isWireframeAndModel = false;

  public getCanvasRelativePosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }

  public createMeasurePoint(point, measurementHexColor) {
    const measurePoint = new Mesh(
        new SphereGeometry(0.03),
        new MeshBasicMaterial(),
    );
    measurePoint.material.color.setHex(measurementHexColor);

    // point is in world space
    measurePoint.position.copy(point);
    // // if we wanted local space then we would use this
    // firstInt.object.worldToLocal(firstInt.point.clone())
    return measurePoint;
  }

  public createDistanceMeasurement({
    firstPoint: point1,
    secondPoint: point2,
  }) {
    const firstPoint = new Vector3(point1.x, point1.y, point1.z);
    const secondPoint = new Vector3(point2.x, point2.y, point2.z);

    const scene = this.scenes.values().next().value;
    const target = scene.target;


    const obj1 = new Object3D();
    const obj2 = new Object3D();
    // const obj1 = new Mesh(
    //     new SphereGeometry(0.03),
    //     new MeshBasicMaterial(),
    // );
    // obj1.material.color.setHex('0x000000');

    // const obj2 = new Mesh(
    //     new SphereGeometry(0.03),
    //     new MeshBasicMaterial(),
    // );
    // obj2.material.color.setHex('0x000000');
    // obj2.identifier = 'id-mything';
    // obj2.position.set(point2.x, point2.y, point2.z);

    // target.add(obj1);

    // This works for the point above
    // scene.add(obj1);

    target.add(obj1);
    obj1.updateMatrixWorld();
    // const newPoint1 = firstPoint.clone();
    console.log('firstPoint', firstPoint);
    obj1.worldToLocal(firstPoint);
    console.log('firstPoint', firstPoint);
    obj1.position.copy(firstPoint);

    target.add(obj2);
    obj2.updateMatrixWorld();
    // const newPoint2 = secondPoint.clone();
    console.log('secondPoint', secondPoint);
    obj2.worldToLocal(secondPoint);
    console.log('secondPoint', secondPoint);
    obj2.position.copy(secondPoint);

    scene.isDirty = true;

    // // Midpoint: https://stackoverflow.com/a/58580387
    // let dir = secondPoint.clone().sub(firstPoint);
    // const length = dir.length();
    // dir = dir.normalize().multiplyScalar(length * .5);
    // const midPoint = firstPoint.clone().add(dir);

    const getScreenPoints =
        (screenWidth, screenHeight) => {
          const camera = scene.getCamera();
          if (scene.autoUpdate === true)
            scene.updateMatrixWorld();
          if (camera.parent === null)
            camera.updateMatrixWorld();

          const firstVector = new Vector3();
          firstVector.setFromMatrixPosition(obj1.matrixWorld);
          const secondVector = new Vector3();
          secondVector.setFromMatrixPosition(obj2.matrixWorld);

          const firstPoint =
              this.getScreenPoint(firstVector, screenWidth, screenHeight);
          const secondPoint =
              this.getScreenPoint(secondVector, screenWidth, screenHeight);

          return {
            firstPoint, secondPoint,
          }
        }

    return {
      onRemoval: () => {
        target.remove(obj1);
        target.remove(obj2);
        scene.isDirty = true;
      }, getScreenPoints, length: secondPoint.clone().sub(firstPoint).length(),
    }
  }

  public getScreenPoint(point, screenWidth, screenHeight) {
    const scene = this.scenes.values().next().value;
    const camera = scene.getCamera();
    const clonedVector = new Vector3;
    clonedVector.copy(point);
    // Taken from:
    // https://discourse.threejs.org/t/how-to-converting-world-coordinates-to-2d-mouse-coordinates-in-threejs/2251
    clonedVector.project(camera);
    return {
      x: (clonedVector.x + 1) * screenWidth / 2,
      y: -(clonedVector.y - 1) * screenHeight / 2,
    };
  }

  // We have to pass in canvas because the model viewer canvas
  // changes width and height randomly
  public getMeasurePoint(e, canvas, {
    snapToEdge,
  }) {
    const pos = this.getCanvasRelativePosition(e, canvas);
    const mouse = {
      x: (pos.x / canvas.width) * 2 - 1,
      y: -(pos.y / canvas.height) * 2 + 1,
    };

    const scene = this.scenes.values().next().value;
    // update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, scene.getCamera());

    const sceneMeshes = [];
    scene.traverse(child => {
      // if (child.name !== 'measurement_entity' && child.name !==
      // 'wireframe') {
      if (child.isMesh) {
        sceneMeshes.push(child);
      }
      // }
    });

    // calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(
        sceneMeshes,
    );
    const firstInt = intersects[0];
    if (typeof firstInt !== 'undefined') {
      const vector =
          this.getClosestVectorToIntersection(firstInt, snapToEdge, canvas);
      return vector;
    }
    return null;
  }

  private getClosestVectorToIntersection(intersection, snapToEdge, canvas) {
    if (snapToEdge) {
      let closestVector = new Vector3();
      let smallestDistance = Infinity;
      const line = new Line3();
      const closestPointPerLine = new Vector3();
      const intLocalPoint = intersection.point.clone();
      intersection.object.worldToLocal(intLocalPoint);
      this.edgeLines.forEach(edgeLine => {
        const {position} = edgeLine.geometry.attributes;
        for (let i = 0; i < position.count - 1; i += 2) {
          line.start.fromBufferAttribute(position, i);
          line.end.fromBufferAttribute(position, i + 1);
          // clamp to true because if not then point is wrong
          line.closestPointToPoint(intLocalPoint, true, closestPointPerLine);

          intersection.object.localToWorld(closestPointPerLine);
          const distance = closestPointPerLine.distanceTo(intersection.point);

          if (distance < smallestDistance) {
            smallestDistance = distance;
            // clone because closestPointPerLine will get modified
            closestVector = closestPointPerLine.clone();
          }
        }
      });

      const {width, height} = canvas.getBoundingClientRect();
      const closestScreenPoint =
          this.getScreenPoint(closestVector, width, height);
      const intScreenPoint =
          this.getScreenPoint(intersection.point, width, height);
      const dx = closestScreenPoint.x - intScreenPoint.x;
      const dy = closestScreenPoint.y - intScreenPoint.y;
      const distanceBetweenScreenPoints = Math.sqrt((dx * dx) + (dy * dy));
      console.log(dx, dy);
      console.log('distanceBetweenScreenPoints', distanceBetweenScreenPoints);
      if (distanceBetweenScreenPoints > 11) {
        return intersection.point;
      }

      return closestVector;
    }
    return intersection.point;
    // const faceData =
    //   [intersection.face.a, intersection.face.b, intersection.face.c];

    // const {position} = intersection.object.geometry.attributes;
    // const vertices = faceData.map(vId => {
    //   const vector = new Vector3();
    //   vector.fromBufferAttribute(position, vId);
    //   vector.distance = intersection.object.localToWorld(vector.clone())
    //                         .distanceTo(intersection.point);
    //   return vector;
    // });

    // vertices.sort(function(a, b) {
    //   return a.distance - b.distance;
    // });

    // const worldPoint = intersection.object.localToWorld(vertices[0]);
    // return worldPoint;
  }

  public onDocumentMouseDown(event, canvas, {snapToEdge = false} = {}) {
    const pos = this.getCanvasRelativePosition(event, canvas);
    const mouse = {
      x: (pos.x / canvas.width) * 2 - 1,
      y: -(pos.y / canvas.height) * 2 + 1,
    };

    const scene = this.scenes.values().next().value;
    // update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, scene.getCamera());

    const sceneChildren = [];
    scene.traverse(child => {
      if (child.name !== 'measurement_entity' && child.name !== 'wireframe') {
        if (child.isMesh) {
          sceneChildren.push(child);
        }
      }
    });

    // calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(
        // scene.children.filter(child => child.name !== 'measurement_group'),
        scene.children,
    );

    const firstInt = intersects[0];
    if (typeof firstInt !== 'undefined') {
      return {
        hit: true,
        intersection: firstInt,
      };
    }
    return {
      hit: false,
    };
  }

  public setEdges() {
    const funcs = [];
    this.edgeLines.forEach(edgeLine => {
      edgeLine.visible = true;
      funcs.push(() => edgeLine.visible = false);
    });

    return () => {
      this.edgeLines.forEach(edgeLine => {
        edgeLine.visible = false;
      });
    };
  }

  public setInvisibleEdges() {
    const scene = this.scenes.values().next().value;
    scene.traverse(child => {
      if (child.isMesh) {
        // console.log(child.name);
        // if (child.name === 'm_Barrel' || child.name ===
        // 'm_Barrel_Material_#30_0') { if (child.name === 'm_WoodenBeams' ||
        // child.name === 'm_WoodenBeams_Material_#25_0') {


        // if (child.name === 'pCube43' || child.name ===
        // 'pCube43_Air_condi_0') {

        // 1`}

        // only show edges with 15 degrees or more angle between faces
        const thresholdAngle = 15;
        const edgeGeometry = new EdgesGeometry(child.geometry, thresholdAngle);
        const line = new LineSegments(
            edgeGeometry, new LineBasicMaterial({color: 0xff0000}));
        line.name = 'wv_entity';
        line.visible = false;
        line.layers.set(1);

        this.edgeLines.push(line);
        console.log('line', line);
        child.add(line);
        // this.bvhs.push({ bvh: new MeshBVH(line.geometry), mesh: line });
        // } else {
        //   child.visible = false;
        // }
        // if (child.name !== 'm_Barrel' && child.name !==
        // 'm_Barrel_Material_#30_0' && child.isMesh) {
        //   child.visible = false;
        // }
        // // if ((child.name === 'm_Barrel' || child.name ===
        // 'm_Barrel_Material_#30_0')) {
        //     // only show edges with 15 degrees or more angle between faces
        //     const thresholdAngle = 15;
        //     const edgeGeometry = new EdgesGeometry(child.geometry,
        //     thresholdAngle); const line = new LineSegments(
        //         edgeGeometry, new LineBasicMaterial({color: 0xffffff}));
        //     line.name = 'edge_entity';
        //     line.visible = false;
        //     this.edgeLines.push(line);
        //     child.add(line);
        // }
      }
    });
  }

  public setVertexNormals() {
    const scene = this.scenes.values().next().value;
    const funcs = [];
    scene.traverse(child => {
      if (child.isMesh && child.name !== 'measurement_entity') {
        const vn = new VertexNormalsHelper(child, 0.05, 0xff0000);
        // vn.name = 'vertexNormalHelper';
        // const wireframeMaterial = new LineBasicMaterial({color: 0xFFFFFF});
        // const wireframe = new LineSegments(wireframeGeometry,
        // wireframeMaterial); wireframe.name = 'wireframe'; child.add(vn);
        // funcs.push(() => child.remove(vn));
        scene.add(vn);
        funcs.push(() => scene.remove(vn));
      }
    });
    return () => {
      funcs.forEach(func => func());
    };
  }

  public setWireframe(willSet = true) {
    const scene = this.scenes.values().next().value;
    // https://discourse.threejs.org/t/proper-way-of-adding-and-removing-a-wireframe/4600

    // https://stackoverflow.com/questions/37280995/threejs-remove-texture
    const wireframeMaterial =
        new MeshBasicMaterial({color: 0xffffff, wireframe: true});

    scene.traverse(child => {
      if (child.isMesh && child.name !== 'measurement_entity') {
        if (willSet) {
          child.oldMaterial = child.material;
          child.material = wireframeMaterial;
        } else {
          child.material = child.oldMaterial;
        }
      }
    });

    if (willSet === true) {
      return () => this.setWireframe(false);
    }
    return () => {};
  }

  public setWireframeAndModel() {
    const scene = this.scenes.values().next().value;
    const funcs = [];
    scene.traverse(child => {
      if (child.isMesh && child.name !== 'measurement_entity') {
        const wireframeGeometry = new WireframeGeometry(child.geometry);
        const wireframeMaterial = new LineBasicMaterial({color: 0xFFFFFF});
        const wireframe =
            new LineSegments(wireframeGeometry, wireframeMaterial);

        wireframe.name = 'wireframe';
        child.add(wireframe);
        funcs.push(() => child.remove(wireframe));
      }
    });
    return () => {
      funcs.forEach(func => func());
    }
  }

  public toggleWireframe(): void {
    const scene = this.scenes.values().next().value;
    // https://discourse.threejs.org/t/proper-way-of-adding-and-removing-a-wireframe/4600

    // https://stackoverflow.com/questions/37280995/threejs-remove-texture
    const wireframeMaterial =
        new MeshBasicMaterial({color: 0xffffff, wireframe: true});

    if (this.isWireframeAndModel) {
      this.toggleWireframeAndModel();
    }

    if (!this.isWireframe) {
      this.isWireframe = true;
    } else {
      this.isWireframe = false;
    }

    scene.traverse(child => {
      if (child.isMesh) {
        if (this.isWireframe) {
          child.oldMaterial = child.material;
          child.material = wireframeMaterial;
        } else {
          child.material = child.oldMaterial;
        }
      }
    });
  }

  public toggleWireframeAndModel(): void {
    const scene = this.scenes.values().next().value;

    if (this.isWireframe) {
      this.toggleWireframe();
    }
    if (!this.isWireframeAndModel) {
      this.isWireframeAndModel = true;
    } else {
      this.isWireframeAndModel = false;
    }

    if (this.isWireframeAndModel) {
      scene.traverse(child => {
        if (child.isMesh) {
          const wireframeGeometry = new WireframeGeometry(child.geometry);
          const wireframeMaterial = new LineBasicMaterial({color: 0xFFFFFF});
          const wireframe =
              new LineSegments(wireframeGeometry, wireframeMaterial);

          wireframe.name = 'wireframe';
          child.add(wireframe);
          this.foo.push(() => child.remove(wireframe));
        }
      });
    } else {
      this.foo.forEach(a => a());
    }
  }

  public getChildren(): Array<Object3D> {
    const scene = this.scenes.values().next().value;

    let children = scene.children;
    while (children && children.length === 1) {
      children = children[0].children;
    }
    return children;
  }

  protected debugger: Debugger|null = null;
  private scenes: Set<ModelScene> = new Set();
  private multipleScenesVisible = false;
  private lastTick: number;
  private scaleStep = 0;
  private lastStep = DEFAULT_LAST_STEP;
  private avgFrameDuration =
      (HIGH_FRAME_DURATION_MS + LOW_FRAME_DURATION_MS) / 2;

  get canRender() {
    return this.threeRenderer != null;
  }

  get scaleFactor() {
    return SCALE_STEPS[this.scaleStep];
  }

  set minScale(scale: number) {
    let i = 1;
    while (i < SCALE_STEPS.length) {
      if (SCALE_STEPS[i] < scale) {
        break;
      }
      ++i;
    }
    this.lastStep = i - 1;
  }

  constructor(options?: RendererOptions) {
    super();

    this.dpr = resolveDpr();

    this.canvasElement = document.createElement('canvas');
    this.canvasElement.id = 'webgl-canvas';

    this.canvas3D = USE_OFFSCREEN_CANVAS ?
        this.canvasElement.transferControlToOffscreen() :
        this.canvasElement;

    this.canvas3D.addEventListener('webglcontextlost', this.onWebGLContextLost);

    try {
      this.threeRenderer = new WebGL1Renderer({
        canvas: this.canvas3D,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance' as WebGLPowerPreference,
        preserveDrawingBuffer: true
      });
      this.threeRenderer.autoClear = true;
      this.threeRenderer.outputEncoding = GammaEncoding;
      this.threeRenderer.physicallyCorrectLights = true;
      this.threeRenderer.setPixelRatio(1);  // handle pixel ratio externally
      this.threeRenderer.shadowMap.enabled = true;
      this.threeRenderer.shadowMap.type = PCFSoftShadowMap;
      this.threeRenderer.shadowMap.autoUpdate = false;

      this.debugger =
          options != null && !!options.debug ? new Debugger(this) : null;
      this.threeRenderer.debug = {checkShaderErrors: !!this.debugger};

      // ACESFilmicToneMapping appears to be the most "saturated",
      // and similar to Filament's gltf-viewer.
      this.threeRenderer.toneMapping = ACESFilmicToneMapping;
    } catch (error) {
      console.warn(error);
    }

    this.arRenderer = new ARRenderer(this);
    this.textureUtils =
        this.canRender ? new TextureUtils(this.threeRenderer) : null;
    this.roughnessMipmapper = new RoughnessMipmapper(this.threeRenderer);
    CachingGLTFLoader.initializeKTX2Loader(this.threeRenderer);

    this.updateRendererSize();
    this.lastTick = performance.now();
    this.avgFrameDuration = 0;
  }

  /**
   * Updates the renderer's size based on the largest scene and any changes to
   * device pixel ratio.
   */
  private updateRendererSize() {
    const dpr = resolveDpr();
    if (dpr !== this.dpr) {
      // If the device pixel ratio has changed due to page zoom, elements
      // specified by % width do not fire a resize event even though their CSS
      // pixel dimensions change, so we force them to update their size here.
      for (const scene of this.scenes) {
        const {element} = scene;
        element[$updateSize](element.getBoundingClientRect());
      }
    }

    // Make the renderer the size of the largest scene
    let width = 0;
    let height = 0;
    for (const scene of this.scenes) {
      width = Math.max(width, scene.width);
      height = Math.max(height, scene.height);
    }

    if (width === this.width && height === this.height && dpr === this.dpr) {
      return;
    }
    this.width = width;
    this.height = height;
    this.dpr = dpr;

    if (this.canRender) {
      this.threeRenderer.setSize(width * dpr, height * dpr, false);
    }

    // Expand the canvas size to make up for shrinking the viewport.
    const scale = this.scaleFactor;
    const widthCSS = width / scale;
    const heightCSS = height / scale;
    // The canvas element must by styled outside of three due to the offscreen
    // canvas not being directly stylable.
    this.canvasElement.style.width = `${widthCSS}px`;
    this.canvasElement.style.height = `${heightCSS}px`;

    // Each scene's canvas must match the renderer size. In general they can be
    // larger than the element that contains them, but the overflow is hidden
    // and only the portion that is shown is copied over.
    for (const scene of this.scenes) {
      const {canvas} = scene;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${widthCSS}px`;
      canvas.style.height = `${heightCSS}px`;
      scene.isDirty = true;
    }
  }

  private updateRendererScale() {
    const scaleStep = this.scaleStep;
    if (this.avgFrameDuration > HIGH_FRAME_DURATION_MS &&
        this.scaleStep < this.lastStep) {
      ++this.scaleStep;
    } else if (
        this.avgFrameDuration < LOW_FRAME_DURATION_MS && this.scaleStep > 0) {
      --this.scaleStep;
    }

    if (scaleStep == this.scaleStep) {
      return;
    }
    const scale = this.scaleFactor;
    this.avgFrameDuration =
        (HIGH_FRAME_DURATION_MS + LOW_FRAME_DURATION_MS) / 2;

    const width = this.width / scale;
    const height = this.height / scale;

    this.canvasElement.style.width = `${width}px`;
    this.canvasElement.style.height = `${height}px`;
    for (const scene of this.scenes) {
      const {style} = scene.canvas;
      style.width = `${width}px`;
      style.height = `${height}px`;
      scene.isDirty = true;
    }
  }

  registerScene(scene: ModelScene) {
    // const obj = new Object3D();
    // obj.identifier = 'id-mything';
    // obj.position.set(0, 0, -10);
    // scene.add(obj);
    // this.sphere = new Mesh(
    //     new SphereGeometry(8.0, 32, 32),
    //     new MeshBasicMaterial({
    //       color: 0x00FF00,
    //       wireframe: true,
    //     }),
    // );
    // this.sphere.geometry.center();
    // this.sphere.position.set(0, 0, -10);
    // // const scene = this.scenes.values().next().value;
    // scene.add(this.sphere);

    // sphere.renderOrder = 99999999;
    // sphere.onBeforeRender = function( renderer ) {
    //   // console.log('onbefore!!!!!!!!');
    //   renderer.clearDepth();
    // };
    // this.scene2 = new Scene();
    // this.scene2.add(sphere);

    // this.snapIndicator = new Mesh(
    //     new SphereGeometry(0.04),
    //     new MeshBasicMaterial({color: 0xff0000}),
    // );
    // scene.add(this.snapIndicator);

    // const material = new LineBasicMaterial({
    //   color: 0xffffff,
    //   // linewidth: 500, // doesn't work lol
    // });

    // const points = [];
    // points.push(new Vector3(-4, 0, 0));
    // points.push(new Vector3(0, 4, 0));
    // // points.push( new Vector3( 4, 0, 0 ) );

    // const geometry = new BufferGeometry().setFromPoints(points);

    // const line = new Line(geometry, material);
    // scene.add(line);

    this.scenes.add(scene);
    const {canvas} = scene;
    const scale = this.scaleFactor;

    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);

    canvas.style.width = `${this.width / scale}px`;
    canvas.style.height = `${this.height / scale}px`;

    if (this.multipleScenesVisible) {
      canvas.classList.add('show');
    }
    scene.isDirty = true;

    if (this.canRender && this.scenes.size > 0) {
      this.threeRenderer.setAnimationLoop((time: number) => this.render(time));
    }

    if (this.debugger != null) {
      this.debugger.addScene(scene);
    }
  }

  unregisterScene(scene: ModelScene) {
    this.scenes.delete(scene);

    if (this.canRender && this.scenes.size === 0) {
      (this.threeRenderer.setAnimationLoop as any)(null);
    }

    if (this.debugger != null) {
      this.debugger.removeScene(scene);
    }
  }

  displayCanvas(scene: ModelScene): HTMLCanvasElement {
    return this.multipleScenesVisible ? scene.element[$canvas] :
                                        this.canvasElement;
  }

  /**
   * The function enables an optimization, where when there is only a single
   * <model-viewer> element, we can use the renderer's 3D canvas directly for
   * display. Otherwise we need to use the element's 2D canvas and copy the
   * renderer's result into it.
   */
  private selectCanvas() {
    let visibleScenes = 0;
    let visibleInput = null;
    for (const scene of this.scenes) {
      const {element} = scene;
      if (element.modelIsVisible) {
        ++visibleScenes;
        visibleInput = element[$userInputElement];
      }
    }
    const multipleScenesVisible = visibleScenes > 1 || USE_OFFSCREEN_CANVAS;
    const {canvasElement} = this;

    if (multipleScenesVisible === this.multipleScenesVisible &&
        (multipleScenesVisible ||
         canvasElement.parentElement === visibleInput)) {
      return;
    }
    this.multipleScenesVisible = multipleScenesVisible;

    if (multipleScenesVisible) {
      canvasElement.classList.remove('show');
    }
    for (const scene of this.scenes) {
      const userInputElement = scene.element[$userInputElement];
      const canvas = scene.element[$canvas];
      if (multipleScenesVisible) {
        canvas.classList.add('show');
        scene.isDirty = true;
      } else if (userInputElement === visibleInput) {
        userInputElement.appendChild(canvasElement);
        canvasElement.classList.add('show');
        canvas.classList.remove('show');
        scene.isDirty = true;
      }
    }
  }

  /**
   * Returns an array version of this.scenes where the non-visible ones are
   * first. This allows eager scenes to be rendered before they are visible,
   * without needing the multi-canvas render path.
   */
  private orderedScenes(): Array<ModelScene> {
    const scenes = [];
    for (const visible of [false, true]) {
      for (const scene of this.scenes) {
        if (scene.element.modelIsVisible === visible) {
          scenes.push(scene);
        }
      }
    }
    return scenes;
  }

  get isPresenting(): boolean {
    return this.arRenderer.isPresenting;
  }

  /**
   * This method takes care of updating the element and renderer state based on
   * the time that has passed since the last rendered frame.
   */
  preRender(scene: ModelScene, t: number, delta: number) {
    const {element, exposure} = scene;

    element[$tick](t, delta);

    const exposureIsNumber =
        typeof exposure === 'number' && !(self as any).isNaN(exposure);
    this.threeRenderer.toneMappingExposure = exposureIsNumber ? exposure : 1.0;

    if (scene.isShadowDirty()) {
      this.threeRenderer.shadowMap.needsUpdate = true;
    }
  }

  render(t: number) {
    const delta = t - this.lastTick;
    this.lastTick = t;

    if (!this.canRender || this.isPresenting) {
      return;
    }

    this.avgFrameDuration += clamp(
        DURATION_DECAY * (delta - this.avgFrameDuration),
        -MAX_AVG_CHANGE_MS,
        MAX_AVG_CHANGE_MS);

    this.selectCanvas();
    this.updateRendererSize();
    this.updateRendererScale();

    const {dpr, scaleFactor} = this;

    for (const scene of this.orderedScenes()) {
      if (!scene.element[$sceneIsReady]()) {
        continue;
      }

      this.preRender(scene, t, delta);

      if (!scene.isDirty) {
        continue;
      }
      scene.isDirty = false;
      ++scene.renderCount;

      if (!scene.element.modelIsVisible && !this.multipleScenesVisible) {
        // Here we are pre-rendering on the visible canvas, so we must mark the
        // visible scene dirty to ensure it overwrites us.
        for (const scene of this.scenes) {
          if (scene.element.modelIsVisible) {
            scene.isDirty = true;
          }
        }
      }

      // We avoid using the Three.js PixelRatio and handle it ourselves here so
      // that we can do proper rounding and avoid white boundary pixels.
      const width = Math.min(
          Math.ceil(scene.width * scaleFactor * dpr), this.canvas3D.width);
      const height = Math.min(
          Math.ceil(scene.height * scaleFactor * dpr), this.canvas3D.height);

      // Need to set the render target in order to prevent
      // clearing the depth from a different buffer
      this.threeRenderer.setRenderTarget(null);
      this.threeRenderer.setViewport(
          0, Math.floor(this.height * dpr) - height, width, height);
      this.threeRenderer.render(scene, scene.getCamera());

      if (this.multipleScenesVisible) {
        if (scene.context == null) {
          scene.createContext();
        }
        if (USE_OFFSCREEN_CANVAS) {
          const contextBitmap = scene.context as ImageBitmapRenderingContext;
          const bitmap =
              (this.canvas3D as OffscreenCanvas).transferToImageBitmap();
          contextBitmap.transferFromImageBitmap(bitmap);
        } else {
          const context2D = scene.context as CanvasRenderingContext2D;
          context2D.clearRect(0, 0, width, height);
          context2D.drawImage(
              this.canvas3D, 0, 0, width, height, 0, 0, width, height);
        }
      }
    }
  }

  dispose() {
    if (this.textureUtils != null) {
      this.textureUtils.dispose();
    }

    if (this.threeRenderer != null) {
      this.threeRenderer.dispose();
    }

    this.textureUtils = null;
    (this as any).threeRenderer = null;

    this.scenes.clear();

    this.canvas3D.removeEventListener(
        'webglcontextlost', this.onWebGLContextLost);
  }

  onWebGLContextLost = (event: Event) => {
    this.dispatchEvent(
        {type: 'contextlost', sourceEvent: event} as ContextLostEvent);
  };
}
