import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Map of MediaPipe FaceLandmarker blendshape names to Ready Player Me / ARKit morph targets
const BLENDSHAPE_MAP: Record<string, string> = {
  // Eyes
  eyeBlinkLeft: 'eyeBlinkLeft',
  eyeBlinkRight: 'eyeBlinkRight',
  eyeLookDownLeft: 'eyeLookDownLeft',
  eyeLookDownRight: 'eyeLookDownRight',
  eyeLookInLeft: 'eyeLookInLeft',
  eyeLookInRight: 'eyeLookInRight',
  eyeLookOutLeft: 'eyeLookOutLeft',
  eyeLookOutRight: 'eyeLookOutRight',
  eyeLookUpLeft: 'eyeLookUpLeft',
  eyeLookUpRight: 'eyeLookUpRight',
  eyeSquintLeft: 'eyeSquintLeft',
  eyeSquintRight: 'eyeSquintRight',
  eyeWideLeft: 'eyeWideLeft',
  eyeWideRight: 'eyeWideRight',

  // Jaw
  jawForward: 'jawForward',
  jawLeft: 'jawLeft',
  jawOpen: 'jawOpen',
  jawRight: 'jawRight',

  // Mouth
  mouthClose: 'mouthClose',
  mouthDimpleLeft: 'mouthDimpleLeft',
  mouthDimpleRight: 'mouthDimpleRight',
  mouthFrownLeft: 'mouthFrownLeft',
  mouthFrownRight: 'mouthFrownRight',
  mouthFunnel: 'mouthFunnel',
  mouthLeft: 'mouthLeft',
  mouthLowerDownLeft: 'mouthLowerDownLeft',
  mouthLowerDownRight: 'mouthLowerDownRight',
  mouthPressLeft: 'mouthPressLeft',
  mouthPressRight: 'mouthPressRight',
  mouthPucker: 'mouthPucker',
  mouthRight: 'mouthRight',
  mouthRollLower: 'mouthRollLower',
  mouthRollUpper: 'mouthRollUpper',
  mouthShrugLower: 'mouthShrugLower',
  mouthShrugUpper: 'mouthShrugUpper',
  mouthSmileLeft: 'mouthSmileLeft',
  mouthSmileRight: 'mouthSmileRight',
  mouthStretchLeft: 'mouthStretchLeft',
  mouthStretchRight: 'mouthStretchRight',
  mouthUpperUpLeft: 'mouthUpperUpLeft',
  mouthUpperUpRight: 'mouthUpperUpRight',

  // Brows
  browDownLeft: 'browDownLeft',
  browDownRight: 'browDownRight',
  browInnerUp: 'browInnerUp',
  browOuterUpLeft: 'browOuterUpLeft',
  browOuterUpRight: 'browOuterUpRight',

  // Cheeks / Nose
  cheekPuff: 'cheekPuff',
  cheekSquintLeft: 'cheekSquintLeft',
  cheekSquintRight: 'cheekSquintRight',
  noseSneerLeft: 'noseSneerLeft',
  noseSneerRight: 'noseSneerRight',
};

export class ThreeAvatarRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  
  private currentModel: THREE.Group | null = null;
  private headBone: THREE.Object3D | null = null;
  private neckBone: THREE.Object3D | null = null;
  private meshesWithMorphs: THREE.Mesh[] = [];
  
  private isLoaded = false;
  private isLoading = false;
  private bgTexture: THREE.CanvasTexture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    
    // 1. Initialize Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true // Required for canvas recording
    });
    this.renderer.setSize(this.canvas.width, this.canvas.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    // 2. Initialize Scene
    this.scene = new THREE.Scene();

    // 3. Initialize Camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.canvas.width / this.canvas.height,
      0.1,
      100
    );
    // Position camera to frame the avatar chest-up
    this.camera.position.set(0, 1.45, 0.7);
    this.camera.lookAt(0, 1.43, 0);

    // 4. Initialize Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(2, 4, 5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xe0e7ff, 0.6); // Slightly warm/blue light
    fillLight.position.set(-2, 2, -2);
    this.scene.add(fillLight);
  }

  // Load avatar from a GLB URL
  public async loadAvatar(url: string, onLoadProgress?: (pct: number) => void): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;
    this.isLoaded = false;

    // Remove existing model if any
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
      this.headBone = null;
      this.neckBone = null;
      this.meshesWithMorphs = [];
    }

    const loader = new GLTFLoader();
    
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          this.currentModel = model;

          // Align avatar in center
          model.position.set(0, 0, 0);
          
          // Add shadow settings
          model.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              
              // Find meshes that support morph targets (blendshapes)
              if (child.morphTargetDictionary && child.morphTargetInfluences) {
                this.meshesWithMorphs.push(child);
              }
            }

            // Find head and neck bones (Ready Player Me naming convention)
            if (child.isBone) {
              const nameLower = child.name.toLowerCase();
              if (nameLower.includes('head') && !nameLower.includes('top')) {
                this.headBone = child;
              } else if (nameLower.includes('neck')) {
                this.neckBone = child;
              }
            }
          });

          // Fallback bone search if not found
          if (!this.headBone) {
            model.traverse((child: any) => {
              if (child.isBone && child.name.includes('Joint_Head')) {
                this.headBone = child;
              }
            });
          }

          this.scene.add(model);
          this.isLoaded = true;
          this.isLoading = false;
          resolve();
        },
        (xhr) => {
          if (xhr.total && onLoadProgress) {
            const percent = (xhr.loaded / xhr.total) * 100;
            onLoadProgress(percent);
          }
        },
        (error) => {
          this.isLoading = false;
          console.error('Error loading 3D GLTF Avatar:', error);
          reject(error);
        }
      );
    });
  }

  // Update rendering with landmarks and blendshapes
  public update(
    landmarks: any[], 
    blendshapes: Array<{ categoryName: string; score: number }>
  ) {
    if (!this.isLoaded || !this.currentModel) return;

    // 1. Update Head Rotation (from landmarks)
    if (landmarks && landmarks.length > 0) {
      // Key facial landmark indices
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const noseTip = landmarks[1];
      const forehead = landmarks[10];
      const chin = landmarks[152];
      const leftCheek = landmarks[234];
      const rightCheek = landmarks[454];

      if (leftEye && rightEye && noseTip && forehead && chin && leftCheek && rightCheek) {
        // Roll: tilt left/right (vector pointing from right eye to left eye in MediaPipe coords)
        const dx = leftEye.x - rightEye.x;
        const dy = leftEye.y - rightEye.y;
        const roll = Math.atan2(dy, dx);

        // Yaw: turn left/right (using absolute cheek width to keep direction consistent)
        const cheekWidth = Math.abs(leftCheek.x - rightCheek.x);
        const noseRelativeX = (leftCheek.x - noseTip.x) / cheekWidth;
        const yaw = (noseRelativeX - 0.5) * Math.PI * 0.9;

        // Pitch: look up/down
        const faceHeight = chin.y - forehead.y;
        const noseRelativeY = (noseTip.y - forehead.y) / faceHeight;
        const pitch = (noseRelativeY - 0.45) * Math.PI * 0.8;

        // Apply to Head and Neck bones (blend for natural motion)
        if (this.headBone) {
          // Three.js coordinates: pitch is X, yaw is Y, roll is Z
          // Ready Player Me axes might be slightly different or need clamping
          this.headBone.rotation.x = THREE.MathUtils.lerp(this.headBone.rotation.x, pitch * 0.7, 0.25);
          this.headBone.rotation.y = THREE.MathUtils.lerp(this.headBone.rotation.y, yaw * 0.7, 0.25);
          this.headBone.rotation.z = THREE.MathUtils.lerp(this.headBone.rotation.z, roll * 0.7, 0.25);
        }
        
        if (this.neckBone) {
          this.neckBone.rotation.x = THREE.MathUtils.lerp(this.neckBone.rotation.x, pitch * 0.3, 0.25);
          this.neckBone.rotation.y = THREE.MathUtils.lerp(this.neckBone.rotation.y, yaw * 0.3, 0.25);
          this.neckBone.rotation.z = THREE.MathUtils.lerp(this.neckBone.rotation.z, roll * 0.3, 0.25);
        }
      }
    }

    // 2. Update Face Morph Targets (Blendshapes)
    if (blendshapes && blendshapes.length > 0) {
      // Convert blendshapes list to a map
      const bsMap: Record<string, number> = {};
      blendshapes.forEach((item) => {
        bsMap[item.categoryName] = item.score;
      });

      // Apply to all meshes that have morph targets
      this.meshesWithMorphs.forEach((mesh) => {
        const dict = mesh.morphTargetDictionary;
        const influences = mesh.morphTargetInfluences;

        if (dict && influences) {
          Object.entries(BLENDSHAPE_MAP).forEach(([mpName, rpmName]) => {
            const score = bsMap[mpName];
            if (score !== undefined) {
              // Standard RPM avatars can prefix morph targets, check exact match or containing string
              let targetIdx = dict[rpmName];
              
              if (targetIdx === undefined) {
                // Try searching with case-insensitive / prefixed names
                const key = Object.keys(dict).find(k => k.endsWith(rpmName) || k.toLowerCase() === rpmName.toLowerCase());
                if (key) targetIdx = dict[key];
              }

              if (targetIdx !== undefined) {
                // Smooth transition using linear interpolation
                influences[targetIdx] = THREE.MathUtils.lerp(influences[targetIdx], score, 0.4);
              }
            }
          });
        }
      });
    }

    // 3. Render
    this.renderer.render(this.scene, this.camera);
  }

  // Set and update background texture using a 2D source canvas (e.g. camera feed)
  public updateBackgroundTexture(sourceCanvas: HTMLCanvasElement) {
    if (!this.bgTexture) {
      this.bgTexture = new THREE.CanvasTexture(sourceCanvas);
      this.scene.background = this.bgTexture;
    } else {
      this.bgTexture.needsUpdate = true;
    }
  }

  // Handle aspect ratio changes
  public resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // Cleanup
  public destroy() {
    this.isLoaded = false;
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
    }
    if (this.bgTexture) {
      this.bgTexture.dispose();
      this.bgTexture = null;
    }
    this.renderer.dispose();
  }

  public getReadyState(): boolean {
    return this.isLoaded;
  }
}
