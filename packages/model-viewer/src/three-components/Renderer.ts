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

import {ACESFilmicToneMapping, BoxGeometry, BufferGeometry, Color, DoubleSide, EdgesGeometry, Event, EventDispatcher, GammaEncoding, Group, Line, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshNormalMaterial, MeshPhongMaterial, MeshStandardMaterial, PCFSoftShadowMap, PlaneGeometry, Ray, Raycaster, SphereGeometry, Vector2, Vector3, WebGL1Renderer, WireframeGeometry} from 'three';
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
  public isWireframe = false;
  public isWireframeAndModel = false;

  public getCanvasRelativePosition(event) {
    const rect = this.canvasElement.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this.canvasElement.width / rect.width,
      y: (event.clientY - rect.top) * this.canvasElement.height / rect.height,
    };
  }


  public createMeasurePoint(point, measurementHexColor, selectedHexColor) {
    const measurePoint = new Mesh(
        new SphereGeometry(0.03),
        new MeshBasicMaterial(),
    );
    measurePoint.material.color.setHex(measurementHexColor);
    measurePoint.highlight = () => {
      measurePoint.material.color.setHex(selectedHexColor);
    };
    measurePoint.unhighlight = () => {
      measurePoint.material.color.setHex(measurementHexColor);
    };

    // point is in world space
    measurePoint.position.copy(point);
    // // if we wanted local space then we would use this
    // firstInt.object.worldToLocal(firstInt.point.clone())
    return measurePoint;
  }

  public createDistanceMeasurement({
    firstPoint,
    secondPoint,
    measurementHexColor = '0x000000',
    selectedHexColor = '0xffff00',
  }) {
    const group = new Group();
    group.name = 'measurement_group';

    const firstMeasurePoint = this.createMeasurePoint(
        firstPoint, measurementHexColor, selectedHexColor)
    firstMeasurePoint.name = 'measurement_entity';
    group.add(firstMeasurePoint);
    const secondMeasurePoint = this.createMeasurePoint(
        secondPoint, measurementHexColor, selectedHexColor)
    secondMeasurePoint.name = 'measurement_entity';
    group.add(secondMeasurePoint);

    const positions = [];
    const geometry = new LineGeometry();

    positions.push(firstPoint.x, firstPoint.y, firstPoint.z);
    positions.push(secondPoint.x, secondPoint.y, secondPoint.z);

    geometry.setPositions(positions);

    const matLine = new LineMaterial({
      color: 0xffffff,   // doesn't do anything lol
      linewidth: 0.005,  // in pixels
      vertexColors: true,
      dashed: false,
      alphaToCoverage: true,
    });

    const setColors = hex => {
      const colors = [];
      const color1 = new Color();
      const color2 = new Color();
      color1.setHex(hex);
      color2.setHex(hex);
      colors.push(color1.r, color1.g, color1.b);
      colors.push(color2.r, color2.g, color2.b);
      geometry.setColors(colors);
      firstMeasurePoint.material.color.setHex(hex);
      secondMeasurePoint.material.color.setHex(hex);
      scene.isDirty = true;
    };

    const line = new Line2(geometry, matLine);
    line.computeLineDistances();
    line.name = 'measurement_entity';
    line.highlight = () => {
      setColors(selectedHexColor);
    };
    line.unhighlight = () => {
      setColors(measurementHexColor);
    };
    group.add(line);

    const scene = this.scenes.values().next().value;
    setColors(measurementHexColor);
    scene.add(group);
    scene.isDirty = true;

    // // Midpoint: https://stackoverflow.com/a/58580387
    // let dir = secondPoint.clone().sub(firstPoint);
    // const length = dir.length();
    // dir = dir.normalize().multiplyScalar(length * .5);
    // const midPoint = firstPoint.clone().add(dir);

    const getScreenPoints =
        (screenWidth, screenHeight) => {
          const firstPointNormalizedDevice = firstPoint.clone();
          const secondPointNormalizedDevice = secondPoint.clone();
          firstPointNormalizedDevice.project(scene.getCamera());
          secondPointNormalizedDevice.project(scene.getCamera());
          return {
            firstPoint: {
              x: (firstPointNormalizedDevice.x + 1) * screenWidth / 2,
              y: -(firstPointNormalizedDevice.y - 1) * screenHeight / 2,
            },
            secondPoint: {
              x: (secondPointNormalizedDevice.x + 1) * screenWidth / 2,
              y: -(secondPointNormalizedDevice.y - 1) * screenHeight / 2,
            },
          };
        }

    return {
      length: secondPoint.clone().sub(firstPoint).length(),
          remove3dEntity: () => scene.remove(group), selectMeasurement: () => {
            group.children.forEach(mesh => {
              mesh.highlight();
            });
            scene.isDirty = true;
          }, deselectMeasurement: () => {
            group.children.forEach(mesh => {
              mesh.unhighlight();
            });
            scene.isDirty = true;
          }, updateDefaultColor: updatedHex => {
            measurementHexColor = updatedHex;
            setColors(updatedHex);
          }, getScreenPoints,
    }
  }

  public startDistanceMeasurementSkeleton(
      e,
      measurementHexColor = '0x000000',
      selectedHexColor = '0xffff00',
  ) {
    const {
      hit: startHit,
      point: firstPoint,
    } = this.onDocumentMouseDown(e);

    if (startHit) {
      const group = new Group();
      group.name = 'measurement_group';
      const firstSnapIndicator = this.createMeasurePoint(
          firstPoint, measurementHexColor, selectedHexColor);
      firstSnapIndicator.name = 'measurement_entity';
      group.add(firstSnapIndicator);

      const scene = this.scenes.values().next().value;
      scene.add(group);
      scene.isDirty = true;

      const completeDistanceMeasurementSkeleton = _e => {
        const {
          hit: endHit,
          point: secondPoint,
        } = this.onDocumentMouseDown(_e);


        return {
          hit: endHit, firstPoint, secondPoint,
        }

        if (!endHit) {
          return {
            hit: false,
          };
        }

        if (endHit) {
          const secondSnapIndicator = this.createMeasurePoint(
              firstPoint, measurementHexColor, selectedHexColor);

          const positions = [];
          const geometry = new LineGeometry();

          positions.push(firstPoint.x, firstPoint.y, firstPoint.z);
          positions.push(secondPoint.x, secondPoint.y, secondPoint.z);

          const setColors = hex => {
            const colors = [];
            const color1 = new Color();
            const color2 = new Color();
            color1.setHex(hex);
            color2.setHex(hex);
            colors.push(color1.r, color1.g, color1.b);
            colors.push(color2.r, color2.g, color2.b);
            geometry.setColors(colors);
            firstSnapIndicator.material.color.setHex(hex);
            secondSnapIndicator.material.color.setHex(hex);
            scene.isDirty = true;
          };

          geometry.setPositions(positions);
          setColors(measurementHexColor);
          const matLine = new LineMaterial({
            color: 0xffffff,   // doesn't do anything lol
            linewidth: 0.005,  // in pixels
            vertexColors: true,
            dashed: false,
            alphaToCoverage: true,
          });

          const line = new Line2(geometry, matLine);
          line.computeLineDistances();
          line.name = 'measurement_line';
          line.highlight = () => {
            setColors(selectedHexColor);
          };
          line.unhighlight = () => {
            setColors(measurementHexColor);
          };

          secondSnapIndicator.name = 'measurement_entity';
          line.name = 'measurement_entity';
          group.add(secondSnapIndicator);
          group.add(line);

          // // https://stackoverflow.com/a/58580387
          let dir = secondPoint.clone().sub(firstPoint);
          const length = dir.length();
          dir = dir.normalize().multiplyScalar(length * .5);
          const midPoint = firstPoint.clone().add(dir);

          const getScreenPoints =
              (screenWidth, screenHeight) => {
                const firstPointNormalizedDevice = firstPoint.clone();
                const secondPointNormalizedDevice = secondPoint.clone();
                firstPointNormalizedDevice.project(scene.getCamera());
                secondPointNormalizedDevice.project(scene.getCamera());
                return {
                  firstPoint: {
                    x: (firstPointNormalizedDevice.x + 1) * screenWidth / 2,
                    y: -(firstPointNormalizedDevice.y - 1) * screenHeight / 2,
                  },
                  secondPoint: {
                    x: (secondPointNormalizedDevice.x + 1) * screenWidth / 2,
                    y: -(secondPointNormalizedDevice.y - 1) * screenHeight / 2,
                  },
                };
              }

                                             scene.isDirty = true;

          return {
            hit: true,
            midPoint,
            remove3dEntity: () => scene.remove(group),
            length: secondPoint.clone().sub(firstPoint).length(),
            getScreenPoints,
            selectMeasurement: () => {
              group.children.forEach(mesh => {
                mesh.highlight();
              });
              scene.isDirty = true;
            },
            deselectMeasurement: () => {
              group.children.forEach(mesh => {
                mesh.unhighlight();
              });
              scene.isDirty = true;
            },
            updateDefaultColor: updatedHex => {
              measurementHexColor = updatedHex;
              setColors(updatedHex);
            },
            firstPoint,
            secondPoint,
          };
        }
      };
      return {
        hit: true,
        completeDistanceMeasurementSkeleton,
        removeSkeleton: () => {
          scene.remove(group);
          scene.isDirty = true;
        },
      };
    }
    return null;
  }

  public onDocumentMouseDown(event, measurementHexColor, selectedHexColor) {
    const pos = this.getCanvasRelativePosition(event);
    const mouse = {
      x: (pos.x / this.canvasElement.width) * 2 - 1,
      y: -(pos.y / this.canvasElement.height) * 2 + 1,
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
        sceneChildren,
    );
    const firstInt = intersects[0];
    if (typeof firstInt !== 'undefined') {
      return {
        hit: true,
        point: firstInt.point.clone(),
        // snapIndicator: this.createMeasurePoint(firstInt.point,
        // measurementHexColor, selectedHexColor),
      };
    }
    return {
      hit: false,
    };
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
      console.log('children', children);
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
    // const sphere = new Mesh(
    //     new SphereGeometry(8.0, 32, 32),
    //     new MeshBasicMaterial({
    //       color: 0x00FF00,
    //       wireframe: true,
    //     }),
    // );
    // sphere.position.set(0, 0, -10);
    // // sphere.renderOrder = 99999999;
    // // sphere.onBeforeRender = function( renderer ) {
    // //   // console.log('onbefore!!!!!!!!');
    // //   renderer.clearDepth();
    // // };
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
    console.group('scene', scene.children);

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
