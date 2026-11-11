// model3d.js — 3D 生物模型查看器模块
// 使用 Three.js ES module + importmap 加载
// 依赖：three.module.min.js, GLTFLoader.js, OrbitControls.js, CSS2DRenderer.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const model3d = (() => {
  // ─── 常量 ───────────────────────────────────
  const MODEL_DIR = './models/';
  const CSS_VARS = {
    bg: '#0b1220', panel: '#111c2d', line: '#26374e', ink: '#e8f0fb',
    muted: '#a1b3c9', cyan: '#78e4ed', mint: '#81e9c8', violet: '#c1a8ff', warm: '#ffb19c'
  };

  // ─── 模型-场景映射 ──────────────────────────
  // 从 course.js 的 modelMap 读取（运行时注入），此处为后备
  let modelMap = {};
  let modelList = [];

  // ─── 核心对象 ──────────────────────────────
  let container = null;       // #view3d 容器
  let canvas = null;          // Three.js <canvas>
  let renderer = null;        // WebGLRenderer
  let labelRenderer = null;   // CSS2DRenderer
  let scene = null;
  let camera = null;
  let controls = null;
  let clock = null;
  let gridHelper = null;
  let currentModel = null;    // 当前加载的模型 Group
  let mixer = null;           // AnimationMixer
  let labels = [];            // CSS2D 标注列表
  let isActive = false;       // 3D 模式是否激活
  let isLoading = false;
  let loadingManager = null;

  // ─── 状态 ──────────────────────────────────
  const state = {
    autoRotate: true,
    transparency: 0,          // 0–100，外壳透明度
    currentModelFile: '',
    currentSceneIndex: 0,
    viewPreset: 'default'     // default | front | top | side
  };

  // ─── 光照设置 ──────────────────────────────
  function setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(
      0x78e4ed,  // 天空色（主题 cyan）
      0x1a2b3c,  // 地面色
      0.3
    );
    scene.add(hemiLight);

    // 补光
    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.25);
    fillLight.position.set(-5, 0, -3);
    scene.add(fillLight);
  }

  // ─── 场景初始化 ────────────────────────────
  function init() {
    container = document.getElementById('view3d');
    if (!container) return;

    // 清理旧内容
    container.innerHTML = '';

    // 加载管理器
    loadingManager = new THREE.LoadingManager();
    loadingManager.onProgress = (url, loaded, total) => {
      const pct = Math.round(loaded / total * 100);
      updateProgress(pct);
    };
    loadingManager.onError = (url) => {
      showMessage(`加载失败: ${url.split('/').pop()}`);
    };

    // 场景
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CSS_VARS.bg);
    scene.fog = new THREE.Fog(CSS_VARS.bg, 15, 60);

    // 相机
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 440;
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(6, 3, 8);
    camera.lookAt(0, 0, 0);

    // WebGL 渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    canvas = renderer.domElement;
    canvas.style.display = 'block';
    container.appendChild(canvas);

    // CSS2D 标注渲染器
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(w, h);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = state.autoRotate;
    controls.autoRotateSpeed = 0.6;
    controls.minDistance = 1.5;
    controls.maxDistance = 25;
    controls.target.set(0, 0, 0);
    controls.update();

    // 地面网格
    gridHelper = new THREE.GridHelper(12, 24, 0x335577, 0x1a2b3c);
    gridHelper.position.y = -2.5;
    scene.add(gridHelper);

    // 灯光
    setupLights();

    // 时钟（供动画循环使用）
    clock = new THREE.Clock();
    // 不在此启动动画——等 activate() 调用时才启动

    // 窗口大小自适应
    window.addEventListener('resize', onResize);
  }

  let animFrameId = null;

  // ─── 动画循环 ──────────────────────────────
  function animate() {
    if (!isActive) { animFrameId = null; return; }
    animFrameId = requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (controls) controls.update();

    if (mixer) mixer.update(delta);

    if (renderer && camera) {
      renderer.render(scene, camera);
    }
    if (labelRenderer && camera) {
      labelRenderer.render(scene, camera);
    }
  }

  // ─── 窗口自适应 ────────────────────────────
  function onResize() {
    if (!container || !renderer) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }

  // ─── 加载模型 ──────────────────────────────
  function loadModel(filename) {
    if (isLoading) return;
    if (state.currentModelFile === filename && currentModel) {
      // 已加载同一模型，聚焦
      focusModel();
      return;
    }

    isLoading = true;
    showMessage('加载中...');
    updateProgress(0);
    disposeModel();

    const loader = new GLTFLoader(loadingManager);
    const url = MODEL_DIR + encodeURI(filename);

    loader.load(
      url,
      (gltf) => {
        isLoading = false;
        hideMessage();
        updateProgress(100);

        currentModel = gltf.scene;
        state.currentModelFile = filename;

        // 自动缩放适配
        fitModelToView(currentModel);

        // 居中模型
        const box = new THREE.Box3().setFromObject(currentModel);
        const center = new THREE.Vector3();
        box.getCenter(center);
        currentModel.position.sub(center);
        currentModel.position.y += box.getSize(new THREE.Vector3()).y * 0.15;

        scene.add(currentModel);

        // 动画
        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(currentModel);
          gltf.animations.forEach(clip => mixer.clipAction(clip).play());
        }

        // 添加标注
        addLabels(currentModel, filename);

        // 应用当前透明度
        applyTransparency(state.transparency / 100);

        // 重设相机
        resetCamera();
        focusModel();

        // 触发回调（通知 player）
        if (typeof window._onModelLoaded === 'function') {
          window._onModelLoaded(filename);
        }
      },
      (xhr) => {
        if (xhr.total > 0) {
          updateProgress(Math.round(xhr.loaded / xhr.total * 100));
        }
      },
      (error) => {
        isLoading = false;
        showMessage(`加载失败: ${filename}`, true);
        console.error('模型加载失败:', error);
      }
    );
  }

  // ─── 自适应缩放 ────────────────────────────
  function fitModelToView(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 5.5; // 目标包围盒大小，约占视口 60%~75%
    const scale = targetSize / maxDim;
    model.scale.setScalar(scale);
  }

  // ─── 模型销毁 ──────────────────────────────
  function disposeModel() {
    if (currentModel) {
      scene.remove(currentModel);
      disposeRecursive(currentModel);
      currentModel = null;
    }
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
    }
    clearLabels();
    state.currentModelFile = '';
  }

  function disposeRecursive(obj) {
    obj.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => disposeMaterial(m));
        } else {
          disposeMaterial(child.material);
        }
      }
    });
  }

  function disposeMaterial(mat) {
    for (const key of Object.keys(mat)) {
      if (mat[key] && mat[key].isTexture) {
        mat[key].dispose();
      }
    }
    mat.dispose();
  }

  // ─── 标注系统 ──────────────────────────────
  function addLabels(model, filename) {
    clearLabels();
    const labelDefs = getLabelsForModel(filename);
    if (!labelDefs || labelDefs.length === 0) {
      // 无预定义标注，使用包围盒分区法
      addAutoLabels(model);
      return;
    }

    labelDefs.forEach(def => {
      const div = document.createElement('div');
      div.className = 'model3d-label';
      div.textContent = def.name;
      const label = new CSS2DObject(div);
      label.position.set(def.x || 0, def.y || 0, def.z || 0);
      label.userData = { name: def.name, isLabel: true };
      model.add(label);
      labels.push(label);
    });
  }

  function addAutoLabels(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());

    // 包围盒分区标注（上/中/下/左/右/前/后）
    const positions = [
      { pos: [center.x, center.y + size.y * 0.45, center.z], name: '顶部结构' },
      { pos: [center.x, center.y - size.y * 0.45, center.z], name: '底部结构' },
      { pos: [center.x + size.x * 0.45, center.y, center.z], name: '右侧结构' },
      { pos: [center.x - size.x * 0.45, center.y, center.z], name: '左侧结构' },
      { pos: [center.x, center.y, center.z + size.z * 0.45], name: '前部结构' },
      { pos: [center.x, center.y, center.z - size.z * 0.45], name: '后部结构' },
    ];

    positions.forEach(({ pos, name }) => {
      const div = document.createElement('div');
      div.className = 'model3d-label auto-label';
      div.textContent = name;
      const label = new CSS2DObject(div);
      label.position.set(pos[0], pos[1], pos[2]);
      label.userData = { name, isLabel: true, auto: true };
      model.add(label);
      labels.push(label);
    });
  }

  function clearLabels() {
    labels.forEach(l => {
      if (l.parent) l.parent.remove(l);
      if (l.element) l.element.remove();
    });
    labels = [];
  }

  // ─── 透明度 ──────────────────────────────────
  function applyTransparency(value) {
    if (!currentModel) return;
    currentModel.traverse(child => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => setMaterialOpacity(m, value));
        } else {
          setMaterialOpacity(child.material, value);
        }
      }
    });
  }

  function setMaterialOpacity(mat, value) {
    if (mat.transparent === undefined) mat.transparent = true;
    mat.transparent = true;
    mat.opacity = 1 - value * 0.85; // 0 表示完全不透明，1 表示几乎全透明
    mat.depthWrite = value < 0.3;
    mat.needsUpdate = true;
  }

  function setTransparency(value) {
    state.transparency = Math.max(0, Math.min(100, value));
    applyTransparency(state.transparency / 100);
  }

  // ─── 预设视角 ──────────────────────────────
  function setViewPreset(preset) {
    if (!currentModel || !camera || !controls) return;
    state.viewPreset = preset;

    const box = new THREE.Box3().setFromObject(currentModel);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dist = box.getSize(new THREE.Vector3()).length() * 1.1;

    const directions = {
      front:  new THREE.Vector3(0, 0, 1),
      back:   new THREE.Vector3(0, 0, -1),
      top:    new THREE.Vector3(0, 1, 0.001),
      bottom: new THREE.Vector3(0, -1, 0.001),
      left:   new THREE.Vector3(-1, 0, 0),
      right:  new THREE.Vector3(1, 0, 0),
      default: new THREE.Vector3(0.6, 0.4, 0.8)
    };

    const dir = directions[preset] || directions.default;
    const targetPos = center.clone().add(dir.clone().normalize().multiplyScalar(dist));

    animateCamera(targetPos, center);
  }

  function resetCamera() {
    if (!camera || !controls) return;
    setViewPreset('default');
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function animateCamera(targetPos, targetLook) {
    if (!camera || !controls) return;
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = performance.now();
    const duration = 800;

    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      camera.position.lerpVectors(startPos, targetPos, ease);
      controls.target.lerpVectors(startTarget, targetLook, ease);
      controls.update();

      if (t < 1) {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  }

  function focusModel() {
    if (!currentModel) return;
    const box = new THREE.Box3().setFromObject(currentModel);
    const center = new THREE.Vector3();
    box.getCenter(center);
    controls.target.copy(center);
    controls.update();
  }

  // ─── 自动旋转 ──────────────────────────────
  function setAutoRotate(enabled) {
    state.autoRotate = enabled;
    if (controls) controls.autoRotate = enabled;
  }

  function toggleAutoRotate() {
    setAutoRotate(!state.autoRotate);
    return state.autoRotate;
  }

  // ─── UI 辅助 ────────────────────────────────
  function updateProgress(pct) {
    const el = document.getElementById('model3d-progress');
    if (el) {
      el.style.setProperty('--progress', `${pct}%`);
      el.setAttribute('aria-valuenow', String(pct));
      el.hidden = pct >= 100 || pct <= 0;
    }
  }

  function showMessage(msg, isError = false) {
    const el = document.getElementById('model3d-message');
    if (el) {
      el.textContent = msg;
      el.hidden = false;
      el.className = isError ? 'model3d-message error' : 'model3d-message';
    }
  }

  function hideMessage() {
    const el = document.getElementById('model3d-message');
    if (el) el.hidden = true;
  }

  // ─── 标注定义 ──────────────────────────────
  function getLabelsForModel(filename) {
    // 基于文件名匹配预定义标注
    const name = filename.replace('.glb', '');
    const defs = {
      '动物细胞剖面模型': [
        { x: 0.8, y: 1.2, z: 0, name: '细胞核' },
        { x: -1.2, y: -0.5, z: 0.5, name: '线粒体' },
        { x: 2, y: -0.3, z: -0.2, name: '核糖体' },
        { x: 1.5, y: 0.8, z: 1, name: '高尔基体' },
        { x: -0.5, y: 0.4, z: 1.5, name: '内质网' },
        { x: 0.2, y: -1.3, z: 0, name: '细胞质' },
      ],
      '07_细胞核剖面模型': [
        { x: 0, y: 0.8, z: 0.6, name: '核膜' },
        { x: 0, y: 0, z: -0.5, name: '核孔' },
        { x: 0.3, y: -0.5, z: 0, name: '染色质' },
        { x: -0.2, y: 0.5, z: 0.8, name: '核仁' },
      ],
      '12_核糖体模型': [
        { x: 0.5, y: 0.8, z: 0, name: '大亚基' },
        { x: -0.5, y: -0.6, z: 0, name: '小亚基' },
        { x: 0.8, y: -0.2, z: 0.5, name: 'mRNA 通道' },
      ],
      '17_DNA双螺旋结构模型': [
        { x: 0, y: 2.5, z: 0, name: '5′ 端' },
        { x: 0, y: -2.5, z: 0, name: '3′ 端' },
        { x: 0.8, y: 1, z: 0, name: '大沟' },
        { x: -0.8, y: 1, z: 0, name: '小沟' },
        { x: 0, y: 0, z: 1.2, name: '碱基对' },
      ],
      '04_蛋白质三维结构模型': [
        { x: 0.5, y: 1.5, z: 0, name: 'N 端' },
        { x: -0.5, y: -1.5, z: 0, name: 'C 端' },
        { x: 0, y: 0.7, z: 1, name: 'α-螺旋' },
        { x: 0, y: -0.5, z: -1, name: 'β-折叠' },
      ],
      '20_tRNA三维结构': [
        { x: 0, y: 1.2, z: 0, name: '氨基酸臂' },
        { x: 0, y: -1, z: 0.5, name: '反密码子环' },
        { x: 0.5, y: 0.2, z: -0.5, name: 'TψC 环' },
      ],
      '08_线粒体剖面模型': [
        { x: 0, y: 0.5, z: 0.8, name: '外膜' },
        { x: 0, y: -0.3, z: 0.5, name: '内膜' },
        { x: 0.3, y: 0.1, z: -0.5, name: '嵴' },
        { x: 0, y: -0.5, z: 0, name: '基质' },
      ],
      '09_叶绿体剖面模型': [
        { x: 0, y: 0.5, z: 0.7, name: '外膜' },
        { x: 0.4, y: 0.1, z: -0.3, name: '类囊体' },
        { x: -0.3, y: 0, z: -0.5, name: '基粒' },
        { x: 0, y: -0.6, z: 0, name: '基质' },
      ],
      '10_粗面内质网模型': [
        { x: 0.8, y: 0.3, z: 0, name: '核糖体' },
        { x: -0.5, y: 0, z: 0.6, name: '膜囊' },
        { x: 0, y: -0.6, z: 0, name: '内腔' },
      ],
      '11_高尔基体模型': [
        { x: 0, y: 0.8, z: 0, name: '顺面' },
        { x: 0, y: -0.3, z: 0.5, name: '扁平囊' },
        { x: 0, y: -0.8, z: 0, name: '反面' },
      ],
      '15_中心体模型': [
        { x: 0.3, y: 0.5, z: 0, name: '中心粒' },
        { x: -0.3, y: -0.5, z: 0, name: '中心粒' },
        { x: 0, y: 0, z: 0.8, name: '微管' },
      ],
      '05_磷脂双分子层结构模型': [
        { x: 0, y: 0.4, z: 0, name: '亲水头部' },
        { x: 0, y: -0.4, z: 0, name: '疏水尾部' },
        { x: 0.8, y: 0, z: 0, name: '膜蛋白' },
      ],
      '21_神经元模型': [
        { x: 0, y: 0.8, z: 0, name: '树突' },
        { x: 0, y: -0.2, z: 0.5, name: '胞体' },
        { x: -0.3, y: -0.6, z: -0.3, name: '轴突' },
        { x: -0.5, y: -1.2, z: 0, name: '髓鞘' },
        { x: 0.2, y: -1.8, z: 0, name: '突触末梢' },
      ],
    };
    return defs[name] || null;
  }

  // ─── 场景模型映射 ──────────────────────────
  function getModelsForScene(sceneIndex) {
    if (modelMap[sceneIndex]) return modelMap[sceneIndex];
    // 后备映射
    const fallback = [
      ['动物细胞剖面模型.glb', '07_细胞核剖面模型.glb', '12_核糖体模型.glb'],     // 场景0: 进入细胞
      ['17_DNA双螺旋结构模型.glb', '07_细胞核剖面模型.glb'],                       // 场景1: DNA转录
      ['07_细胞核剖面模型.glb'],                                                    // 场景2: RNA加工
      ['07_细胞核剖面模型.glb'],                                                    // 场景3: mRNA出核
      ['12_核糖体模型.glb', '20_tRNA三维结构.glb'],                                // 场景4: 翻译延伸
      ['12_核糖体模型.glb', '04_蛋白质三维结构模型.glb'],                          // 场景5: 翻译终止
      ['04_蛋白质三维结构模型.glb'],                                                // 场景6: 多肽折叠
    ];
    return fallback[sceneIndex] || [modelList[0]];
  }

  // ─── 3D 模型库面板 ──────────────────────────
  function showModelLibrary() {
    const panel = document.getElementById('model-library');
    if (!panel) return;
    panel.hidden = false;

    const grid = panel.querySelector('.model-grid');
    if (!grid) return;
    grid.innerHTML = '';

    modelList.forEach((filename, i) => {
      const name = filename.replace('.glb', '');
      const card = document.createElement('button');
      card.className = 'model-card';
      card.type = 'button';
      card.innerHTML = `<span class="model-card-index">${String(i + 1).padStart(2, '0')}</span><span class="model-card-name">${name}</span>`;
      card.addEventListener('click', () => {
        loadModel(filename);
        panel.hidden = true;
        switchTo3D();
      });
      grid.appendChild(card);
    });
  }

  function hideModelLibrary() {
    const panel = document.getElementById('model-library');
    if (panel) panel.hidden = true;
  }

  // ─── 初始化/激活/停用 ──────────────────────
  function activate() {
    if (!container) {
      // 首次激活，完整初始化
      if (!initScene()) return;
    }
    isActive = true;
    container.style.display = 'block';
    onResize();

    // 恢复动画
    if (renderer && scene && camera) {
      animate();
    }

    // 加载当前场景对应模型
    if (!currentModel && modelList.length > 0) {
      const models = getModelsForScene(state.currentSceneIndex);
      if (models.length > 0) {
        loadModel(models[0]);
      }
    }
  }

  function initScene() {
    // 创建 #view3d 容器
    const viewport = document.querySelector('.viewport');
    if (!viewport) return false;
    let view3d = document.getElementById('view3d');
    if (!view3d) {
      view3d = document.createElement('div');
      view3d.id = 'view3d';
      view3d.style.cssText = 'position:absolute;inset:0;display:none;';
      viewport.appendChild(view3d);
    }
    container = view3d;
    init();
    return true;
  }

  function deactivate() {
    isActive = false;
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (container) container.style.display = 'none';
  }

  function switchTo3D() {
    deactivate2D();
    activate();
  }

  function switchTo2D() {
    deactivate();
    activate2D();
  }

  function deactivate2D() {
    const art = document.getElementById('art');
    if (art) art.style.display = 'none';
  }

  function activate2D() {
    const art = document.getElementById('art');
    if (art) art.style.display = 'block';
    const view3d = document.getElementById('view3d');
    if (view3d) view3d.style.display = 'none';
  }

  // ─── 模型列表管理 ──────────────────────────
  function setModelList(list) {
    modelList = list;
  }

  function setModelMap(map) {
    modelMap = map;
  }

  function setSceneIndex(index) {
    state.currentSceneIndex = index;
    if (isActive) {
      const models = getModelsForScene(index);
      if (models.length > 0 && models[0] !== state.currentModelFile) {
        loadModel(models[0]);
      }
    }
  }

  // ─── 当前模型名 ────────────────────────────
  function getCurrentModelName() {
    if (!state.currentModelFile) return '未加载';
    return state.currentModelFile.replace('.glb', '');
  }

  // ─── 销毁 ──────────────────────────────────
  function destroy() {
    isActive = false;
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    disposeModel();
    clearLabels();
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    if (labelRenderer && labelRenderer.domElement) {
      labelRenderer.domElement.remove();
    }
    if (canvas) {
      canvas.remove();
      canvas = null;
    }
    if (container) {
      container.innerHTML = '';
    }
    scene = null;
    camera = null;
    controls = null;
    clock = null;
    mixer = null;
    gridHelper = null;
    window.removeEventListener('resize', onResize);
  }

  // ─── 公开 API ──────────────────────────────
  return {
    // 初始化（首次调用，由 player 触发）
    boot() {
      return initScene();
    },

    // 激活/停用
    activate,
    deactivate,
    switchTo3D,
    switchTo2D,

    // 模式判断
    isActive() { return isActive && container && container.style.display !== 'none'; },

    // 模型操作
    loadModel,
    loadModelsForScene(sceneIndex) {
      setSceneIndex(sceneIndex);
      const models = getModelsForScene(sceneIndex);
      if (isActive && models.length > 0) {
        loadModel(models[0]);
      }
      return models;
    },
    getModelsForScene,

    // 视角
    setViewPreset,
    resetCamera,

    // 自动旋转
    setAutoRotate,
    toggleAutoRotate,
    isAutoRotating() { return state.autoRotate; },

    // 透明度
    setTransparency,
    getTransparency() { return state.transparency; },

    // 模型信息
    getCurrentModelName,
    getCurrentModelFile() { return state.currentModelFile; },
    isLoading() { return isLoading; },

    // 模型库
    showModelLibrary,
    hideModelLibrary,

    // 列表/映射（由 course.js 注入）
    setModelList,
    setModelMap,

    // 场景切换
    setSceneIndex,

    // 销毁
    destroy,

    // 标签
    getLabelsForModel,
  };
})();

// 挂载到全局
window.model3d = model3d;
export default model3d;