"use strict";

(() => {
  const { scenes, modelList, modelMap } = course;
  const $ = id => document.getElementById(id);
  const ui = {
    art: $("art"), steps: $("steps"), route: $("route-counter"), kicker: $("scene-kicker"),
    title: $("scene-title"), location: $("scene-location"), scale: $("scene-scale"),
    captionLabel: $("caption-label"), caption: $("caption-text"),
    kind: $("task-kind"), copy: $("lesson-copy"), task: $("task-card"), feedback: $("task-feedback"),
    detail: $("lesson-detail"), next: $("next-scene"), nextText: $("next-scene-text"),
    prevFrame: $("prev-frame"), nextFrame: $("next-frame"), play: $("play"), playIcon: $("play-icon"),
    playLabel: $("play-label"), replay: $("replay"), progress: $("progress"), clock: $("clock"),
    frameName: $("frame-name"), marks: $("frame-marks"), speed: $("speed"),
    largeType: $("large-type"), fullscreen: $("fullscreen"),
    // 3D 相关
    modeSwitch: $("mode-switch"), modeSwitchLabel: $("mode-switch-label"),
    toolbar3d: $("toolbar3d"), opacity3d: $("opacity3d"), opacitySlider: $("opacity3d-slider"),
    modelSelector: $("model-selector"), modelSelect: $("model-select"),
    modelLibrary: $("model-library"), modelLibraryBtn: $("model-library-btn"),
    libraryClose: $("library-close"), model3dName: $("model3d-name"),
    viewportMeta2d: $("viewport-meta-2d"), viewportMeta3d: $("viewport-meta-3d"),
    schematicTag2d: $("schematic-tag-2d"), schematicTag3d: $("schematic-tag-3d"),
    dock: document.querySelector(".dock"), webglWarning: $("webgl-warning")
  };
  const state = {
    index: 0, time: 0, playing: false, speed: 1, solved: false, selected: "", focus: "",
    focusBlend: 0, feedback: "", tone: "", visited: new Set(),
    is3D: false  // 当前是否为 3D 模式
  };
  const pad = n => String(n).padStart(2, "0");
  const timestamp = seconds => `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const scene = () => scenes[state.index];
  const gateTime = () => scene().frames[scene().gate]?.at ?? Infinity;
  const maxTime = () => state.solved ? scene().duration : Math.min(gateTime(), scene().duration);
  const atGate = () => !state.solved && state.time >= gateTime();
  const frameIndex = () => scene().frames.findLastIndex(frame => state.time >= frame.at);
  const mode = () => state.playing ? "playing" : atGate() ? "waiting" : state.time === scene().duration ? "done" : "paused";

  let animationId = null;
  let lastTick = null;
  let lastPaint = null;
  let focusAnimation = null;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // ─── 3D 模块就绪检测 ──────────────────────
  let model3dReady = false;
  function waitForModel3D(callback) {
    if (window.model3d) { model3dReady = true; callback(); return; }
    // model3d 是 ES module，可能在 player 之后加载
    const check = setInterval(() => {
      if (window.model3d) {
        clearInterval(check);
        model3dReady = true;
        callback();
      }
    }, 50);
    // 5 秒超时
    setTimeout(() => { clearInterval(check); if (!model3dReady) callback(); }, 5000);
  }

  function boot3D() {
    if (!window.model3d) return;
    const m3d = window.model3d;

    // 注入模型数据
    m3d.setModelList(modelList);
    m3d.setModelMap(modelMap);

    // 初始化 3D 场景
    const ok = m3d.boot();
    if (!ok) {
      // WebGL 不可用
      ui.webglWarning.hidden = false;
      ui.modeSwitch.hidden = true;
      return;
    }

    // 显示 3D 相关 UI
    ui.modeSwitch.hidden = false;
    ui.modelLibraryBtn.hidden = false;

    // 模型加载完成回调
    window._onModelLoaded = (filename) => {
      setText(ui.model3dName, filename.replace('.glb', ''));
      updateOpacitySlider();
    };
  }

  // ─── 2D/3D 模式切换 ──────────────────────
  function switchMode() {
    if (!window.model3d) return;
    const m3d = window.model3d;
    state.is3D = !state.is3D;
    applyMode();
  }

  function applyMode() {
    const m3d = window.model3d;
    if (!m3d) return;

    if (state.is3D) {
      // 切换到 3D
      m3d.switchTo3D();
      m3d.setSceneIndex(state.index);
      ui.art.style.display = 'none';
      ui.toolbar3d.hidden = false;
      ui.opacity3d.hidden = false;
      ui.modelSelector.hidden = false;
      ui.viewportMeta2d.hidden = true;
      ui.viewportMeta3d.hidden = false;
      ui.schematicTag2d.hidden = true;
      ui.schematicTag3d.hidden = false;
      setText(ui.model3dName, m3d.getCurrentModelName());
      updateModelSelector();
      updateOpacitySlider();
      // 更新切换按钮样式
      ui.modeSwitch.setAttribute('aria-pressed', 'true');
      setText(ui.modeSwitchLabel, '2D 动画');
      // Dock 模式标记
      if (ui.dock) ui.dock.setAttribute('data-mode', '3d');
      // 暂停 2D 播放
      pause();
      // 更新 viewport meta
      ui.location.textContent = '3D 模型';
      ui.scale.textContent = '3D 视图';
    } else {
      // 切换到 2D
      m3d.switchTo2D();
      ui.art.style.display = 'block';
      ui.toolbar3d.hidden = true;
      ui.opacity3d.hidden = true;
      ui.modelSelector.hidden = true;
      ui.viewportMeta2d.hidden = false;
      ui.viewportMeta3d.hidden = true;
      ui.schematicTag2d.hidden = false;
      ui.schematicTag3d.hidden = true;
      ui.modeSwitch.setAttribute('aria-pressed', 'false');
      setText(ui.modeSwitchLabel, '3D 模型');
      if (ui.dock) ui.dock.removeAttribute('data-mode');
      // 恢复 2D 元数据
      const item = scene();
      ui.location.textContent = item.location;
      ui.scale.textContent = item.scale;
      // 重绘 2D
      renderArt();
    }
  }

  // ─── 模型选择器 ─────────────────────────────
  function updateModelSelector() {
    if (!window.model3d) return;
    const m3d = window.model3d;
    const models = m3d.getModelsForScene(state.index) || [];
    ui.modelSelect.innerHTML = models.map(fn => {
      const name = fn.replace('.glb', '');
      const selected = fn === m3d.getCurrentModelFile() ? ' selected' : '';
      return `<option value="${fn}"${selected}>${name}</option>`;
    }).join('');
  }

  function updateOpacitySlider() {
    if (!window.model3d) return;
    const m3d = window.model3d;
    ui.opacitySlider.value = m3d.getTransparency();
    ui.opacitySlider.style.setProperty('--progress', `${m3d.getTransparency()}%`);
  }

  // ─── 3D 控制事件绑定 ──────────────────────
  function bind3DControls() {
    // 模式切换按钮
    ui.modeSwitch.addEventListener('click', switchMode);

    // 3D 工具栏 - 预设视角
    $("btn-view-default").addEventListener('click', () => window.model3d?.setViewPreset('default'));
    $("btn-view-front").addEventListener('click', () => window.model3d?.setViewPreset('front'));
    $("btn-view-top").addEventListener('click', () => window.model3d?.setViewPreset('top'));
    $("btn-view-side").addEventListener('click', () => window.model3d?.setViewPreset('right'));

    // 自动旋转
    const btnAutoRotate = $("btn-auto-rotate");
    btnAutoRotate.addEventListener('click', () => {
      if (!window.model3d) return;
      const active = window.model3d.toggleAutoRotate();
      btnAutoRotate.setAttribute('aria-pressed', String(active));
      btnAutoRotate.classList.toggle('active', active);
    });

    // 复位视角
    $("btn-reset-camera").addEventListener('click', () => window.model3d?.resetCamera());

    // 透明度滑块
    ui.opacitySlider.addEventListener('input', () => {
      const val = Number(ui.opacitySlider.value);
      ui.opacitySlider.style.setProperty('--progress', `${val}%`);
      window.model3d?.setTransparency(val);
    });

    // 模型选择器
    ui.modelSelect.addEventListener('change', () => {
      const filename = ui.modelSelect.value;
      if (filename && window.model3d) {
        window.model3d.loadModel(filename);
      }
    });

    // 模型库
    ui.modelLibraryBtn.addEventListener('click', () => {
      window.model3d?.showModelLibrary();
    });
    ui.libraryClose.addEventListener('click', () => {
      window.model3d?.hideModelLibrary();
    });

    // 键盘快捷键：M 键切换 2D/3D
    document.addEventListener('keydown', (event) => {
      if (event.key === 'm' && !event.ctrlKey && !event.metaKey && !event.altKey
        && document.activeElement === document.body) {
        switchMode();
      }
    });
  }

  // ─── 步骤导航（覆盖以注入 3D 逻辑）─────────
  ui.steps.innerHTML = scenes.map((item, i) => `
    <li><button type="button" class="step" data-scene="${i}">
      <span class="step-index">${pad(i + 1)}</span>
      <span><strong>${item.label}</strong><small>${item.sub}</small></span>
    </button></li>`).join("");

  function makeTask(item) {
    let controls;
    if (item.choices) {
      controls = `<div class="choices${item.compact ? " compact" : ""}">${item.choices.map(choice => `
        <button class="choice" type="button" data-choice="${choice.id}">${choice.text}</button>`).join("")}</div>`;
    } else {
      controls = `<input type="range" class="fold-control" id="fold-control" min="0" max="100" value="0" aria-label="多肽折叠程度">
        <div class="fold-ends"><span>伸展</span><span>折叠</span></div>`;
    }
    return `<span class="panel-label">本步任务</span><p class="prompt">${item.prompt}</p>${controls}<p class="task-note">${item.note}</p>`;
  }

  function makeDetail(item) {
    const facts = `<dl class="facts">${item.facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
    const details = (item.details ?? []).map(([title, copy]) => `<details><summary>${title}</summary><p>${copy}</p></details>`).join("");
    const flow = item.flow ? `<span class="panel-label">点击节点回顾信息流</span><div class="flow" aria-label="DNA 到 RNA 到多肽到蛋白质">
      ${item.flow.map(([label, index], i) => `<button type="button" data-scene="${index}"><small>${i + 1}</small> ${label}</button>`).join("")}
      </div>` : "";
    return facts + details + flow;
  }

  function load(index, focusTitle = false) {
    pause();
    stopFocusAnimation();
    Object.assign(state, { index, time: 0, solved: false, selected: "", focus: "", focusBlend: 0, feedback: "", tone: "" });
    state.visited.add(index);
    const item = scene();
    const position = `${pad(index + 1)} / ${pad(scenes.length)}`;
    ui.route.textContent = position;
    ui.kicker.textContent = `${position}  ·  ${item.key}`;
    ui.title.textContent = item.title;
    ui.location.textContent = state.is3D ? '3D 模型' : item.location;
    ui.scale.textContent = state.is3D ? '3D 视图' : item.scale;
    ui.kind.textContent = item.kind;
    ui.art.setAttribute("aria-label", `${item.label}分子动画${index === 0 ? "，可选细胞核或核糖体" : ""}`);
    ui.copy.innerHTML = `<h4>${item.heading}</h4><p>${item.intro}</p>`;
    ui.task.innerHTML = makeTask(item);
    ui.detail.innerHTML = makeDetail(item);
    ui.marks.innerHTML = item.frames.slice(1, -1).map(({ at }, i) => `
      <i class="${i + 1 === item.gate ? "gate-mark" : ""}" style="left:${100 * at / item.duration}%"></i>`).join("");
    ui.nextText.textContent = index + 1 < scenes.length ? `下一步 · ${scenes[index + 1].label}` : "回到细胞总览";
    for (const step of ui.steps.querySelectorAll(".step")) {
      const selected = Number(step.dataset.scene) === index;
      step.classList.toggle("visited", state.visited.has(Number(step.dataset.scene)));
      if (selected) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    }

    // ─── 3D 联动 ──────────────────────────────
    if (state.is3D && window.model3d) {
      const m3d = window.model3d;
      m3d.setSceneIndex(index);
      updateModelSelector();
      setText(ui.model3dName, m3d.getCurrentModelName());
    }

    render();
    if (focusTitle) ui.title.focus({ preventScroll: true });
    const currentStep = ui.steps.querySelector("[aria-current=step]");
    if (ui.steps.scrollWidth > ui.steps.clientWidth) {
      ui.steps.scrollLeft = currentStep.offsetLeft - ui.steps.offsetLeft - 10;
    }
  }

  function renderArt() {
    if (state.is3D) return; // 3D 模式下不渲染 SVG
    const focusedAction = ui.art.contains(document.activeElement) ? document.activeElement.dataset.action : "";
    ui.art.innerHTML = molecules.render(state.index, scene(), state.time, state);
    ui.art.dataset.frame = frameIndex();
    ui.art.dataset.scene = state.index;
    if (focusedAction) {
      const target = [...ui.art.querySelectorAll("[tabindex]")].find(node => node.dataset.action === focusedAction);
      target?.focus({ preventScroll: true });
    }
  }

  function render() {
    const item = scene();
    const index = frameIndex();
    const frame = item.frames[index];
    const percent = state.time / item.duration;
    setText(ui.captionLabel, `${pad(index + 1)} · ${frame.label}`);
    setText(ui.caption, frame.caption);
    setText(ui.frameName, state.is3D ? '3D 模型浏览模式' : mode() === "waiting" ? `${frame.label} · 等待操作` : frame.label);
    setText(ui.clock, state.is3D ? '3D' : `${timestamp(state.time)} / ${timestamp(item.duration)}`);
    ui.progress.value = Math.round(percent * 1000);
    ui.progress.style.setProperty("--progress", `${percent * 100}%`);
    ui.progress.setAttribute("aria-valuetext", `${state.time.toFixed(1)} 秒，${frame.label}`);
    const playLabel = { playing: "暂停", waiting: "待操作", done: "再播放", paused: "播放" }[mode()];
    setText(ui.playLabel, state.is3D ? '—' : playLabel);
    setText(ui.playIcon, state.playing ? "Ⅱ" : atGate() ? "◇" : "▶");
    ui.play.disabled = state.is3D || atGate();
    ui.prevFrame.disabled = state.is3D || state.time <= 0;
    ui.nextFrame.disabled = state.is3D || state.time >= maxTime();
    ui.art.dataset.status = mode();
    for (const button of ui.task.querySelectorAll("[data-choice]")) {
      const chosen = button.dataset.choice === state.selected;
      const priorToGate = item.gate !== undefined && state.time < gateTime();
      button.disabled = state.is3D || (priorToGate && state.index !== 3) || (state.solved && !chosen);
      button.classList.toggle("correct", chosen && state.solved);
      button.classList.toggle("incorrect", chosen && state.tone === "retry" && !priorToGate);
      if (state.index === 0) button.setAttribute("aria-pressed", String(chosen));
      if (item.gate !== undefined) {
        const choice = item.choices.find(option => option.id === button.dataset.choice);
        setText(button, chosen && state.solved ? `✓ ${choice.text}` : chosen && state.tone === "retry" && !priorToGate ? `× ${choice.text}` : choice.text);
      }
    }
    const showFeedback = Boolean(state.feedback && (item.gate === undefined || state.time >= gateTime()));
    ui.feedback.hidden = showFeedback ? false : true;
    if (showFeedback) {
      setText(ui.feedback, state.feedback);
      ui.feedback.dataset.tone = state.tone;
    } else setText(ui.feedback, "");
    const foldControl = $("fold-control");
    if (foldControl) {
      foldControl.value = Math.round(percent * 100);
      foldControl.setAttribute("aria-valuetext", `${foldControl.value}% 折叠进度`);
    }
    renderArt();
  }

  function pause() {
    state.playing = false;
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    lastTick = null;
    lastPaint = null;
  }

  function updateTime(time) {
    state.time = Math.max(0, Math.min(time, maxTime()));
    if (state.time >= maxTime()) pause();
    render();
  }

  function tick(now) {
    if (!state.playing || state.is3D) return;
    if (lastTick === null) lastTick = now;
    const sinceLastPaint = lastPaint === null ? Infinity : now - lastPaint;
    if (sinceLastPaint >= 29) {
      const next = state.time + Math.min(now - lastTick, 120) * state.speed / 1000;
      lastTick = now;
      lastPaint = now;
      updateTime(next);
    }
    if (state.playing) animationId = requestAnimationFrame(tick);
  }

  function play() {
    if (state.playing || atGate() || state.is3D) return;
    if (state.time === scene().duration) load(state.index);
    state.playing = true;
    if (state.index === 0 && state.focus) setFocus("");
    render();
    animationId = requestAnimationFrame(tick);
  }

  function seek(value) {
    pause();
    updateTime(value);
  }

  function stepFrame(direction) {
    if (state.is3D) return;
    const { frames } = scene();
    const target = direction > 0
      ? frames.find(frame => frame.at > state.time)
      : frames.findLast(frame => frame.at < state.time);
    if (target) seek(target.at);
  }

  function stopFocusAnimation() {
    if (focusAnimation !== null) cancelAnimationFrame(focusAnimation);
    focusAnimation = null;
  }

  function setFocus(id) {
    stopFocusAnimation();
    state.selected = id;
    const entry = scene().choices.find(choice => choice.id === id);
    state.feedback = entry?.feedback ?? "";
    state.tone = "";
    const switching = id && id !== state.focus;
    if (switching) {
      state.focus = id;
      state.focusBlend = 0;
    }
    const from = state.focusBlend;
    const to = id ? 1 : 0;
    if (reducedMotion.matches) {
      state.focusBlend = to;
      state.focus = id;
      render();
      return;
    }
    render();
    const start = performance.now();
    function zoom(now) {
      const p = Math.min(1, (now - start) / 340);
      state.focusBlend = from + (to - from) * (p * p * (3 - 2 * p));
      if (p >= 1) state.focus = id;
      if (!state.playing) renderArt();
      focusAnimation = p < 1 ? requestAnimationFrame(zoom) : null;
    }
    focusAnimation = requestAnimationFrame(zoom);
  }

  function choose(id, fromDiagram = false) {
    if (state.is3D) return; // 3D 模式下不处理答题
    const item = scene();
    const choice = item.choices?.find(option => option.id === id);
    if (!choice) return;
    if (item.gate === undefined) {
      pause();
      setFocus(state.selected === id ? "" : id);
      return;
    }
    if (state.solved || (state.time < gateTime() && state.index !== 3)) return;
    state.selected = id;
    state.feedback = choice.feedback;
    state.tone = choice.correct ? "good" : "retry";
    if (state.time < gateTime()) seek(gateTime());
    state.solved = Boolean(choice.correct);
    render();
    if (fromDiagram && choice.correct) ui.task.querySelector(".correct")?.focus({ preventScroll: true });
    if (choice.correct) play();
  }

  function navigate(event) {
    const target = event.target.closest("[data-scene]");
    if (!target) return;
    load(Number(target.dataset.scene), true);
    if (matchMedia("(max-width: 680px)").matches) {
      ui.title.closest(".scene").scrollIntoView({ block: "start" });
    }
  }

  ui.steps.addEventListener("click", navigate);
  ui.detail.addEventListener("click", navigate);
  ui.next.addEventListener("click", () => {
    load((state.index + 1) % scenes.length, true);
    if (matchMedia("(max-width: 680px)").matches) ui.title.closest(".scene").scrollIntoView({ block: "start" });
  });
  ui.task.addEventListener("click", event => {
    const button = event.target.closest("[data-choice]");
    if (button) choose(button.dataset.choice);
  });
  ui.task.addEventListener("input", event => {
    if (event.target.id === "fold-control") seek(scene().duration * Number(event.target.value) / 100);
  });
  ui.art.addEventListener("click", event => {
    const action = event.target.closest("[data-action]");
    if (action) choose(action.dataset.action, true);
  });
  ui.art.addEventListener("keydown", event => {
    const action = event.target.closest("[data-action]");
    if (action && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      choose(action.dataset.action, true);
    }
  });
  ui.play.addEventListener("click", () => {
    if (state.is3D) return;
    if (state.playing) {
      pause();
      render();
    } else play();
  });
  ui.replay.addEventListener("click", () => {
    if (state.is3D) return;
    load(state.index);
    play();
  });
  ui.prevFrame.addEventListener("click", () => stepFrame(-1));
  ui.nextFrame.addEventListener("click", () => stepFrame(1));
  ui.progress.addEventListener("input", () => seek(scene().duration * Number(ui.progress.value) / 1000));
  ui.speed.addEventListener("change", () => { state.speed = Number(ui.speed.value); });
  ui.largeType.addEventListener("click", () => {
    const active = document.documentElement.classList.toggle("large-type");
    ui.largeType.setAttribute("aria-pressed", String(active));
  });
  function syncFullscreen() {
    const active = Boolean(document.fullscreenElement || document.documentElement.classList.contains("fullscreen-fallback"));
    ui.fullscreen.setAttribute("aria-pressed", String(active));
    ui.fullscreen.lastChild.textContent = active ? " 退出" : " 全屏";
    ui.fullscreen.setAttribute("aria-label", active ? "退出全屏或专注显示" : "全屏或专注显示");
  }
  function toggleFocusDisplay() {
    document.documentElement.classList.toggle("fullscreen-fallback");
    window.scrollTo(0, 0);
    syncFullscreen();
  }
  ui.fullscreen.addEventListener("click", async () => {
    if (!document.fullscreenEnabled || document.documentElement.classList.contains("fullscreen-fallback")) {
      toggleFocusDisplay();
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toggleFocusDisplay();
    }
  });
  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing) {
      pause();
      render();
    }
  });
  syncFullscreen();

  // ─── 启动 ──────────────────────────────────
  bind3DControls();
  waitForModel3D(() => {
    boot3D();
  });
  load(0);
})();