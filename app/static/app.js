"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentMishna = null;
let project = null;
let references = [];
let refModalMinuteId = null;
let refModalSceneId = null;

// סדר השלבים של ה-Wizard
const STEPS = ["transcription", "content", "images", "video"];
let currentStep = "transcription";
const STEP_LABELS = {
  transcription: "המשך: מלא משנה + Prompt ←",
  content: "המשך: צור תמונות ←",
  images: "המשך: הרכב וידאו ←",
  video: "הסתיים ✓",
};

function setStep(step) {
  currentStep = step;
  const idx = STEPS.indexOf(step);
  $$(".wizard-step").forEach((el) => {
    const i = STEPS.indexOf(el.dataset.step);
    el.classList.toggle("active", i === idx);
    el.classList.toggle("done", i < idx);
  });
  const btn = $("#nextStepBtn");
  if (btn) {
    btn.textContent = STEP_LABELS[step] || "המשך לשלב הבא →";
    btn.disabled = step === "video";
  }
}

// קביעת השלב ההתחלתי לפי הנתונים הקיימים בפרויקט
function inferStep() {
  const minuteSlots = (project && project.slots) || [];
  if (!minuteSlots.length) return "transcription";
  
  let allHaveImages = true;
  let allHavePrompts = true;
  
  for (const minute of minuteSlots) {
    for (const scene of minute.scenes || []) {
      if (!scene.image_path) allHaveImages = false;
      if (!scene.prompt || !scene.prompt.trim()) allHavePrompts = false;
    }
  }
  
  if (allHaveImages) return "video";
  if (allHavePrompts) return "images";
  return "transcription";
}

const audio = new Audio();
let audioStopTimer = null;

function setStatus(msg, kind = "") {
  const el = $("#status");
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + kind;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

function renderGlobalRefs() {
  const container = $("#globalRefsList");
  if (!container) return;
  container.innerHTML = "";
  references.forEach(r => {
    const item = document.createElement("div");
    item.className = "ref-list-item";
    item.innerHTML = `<img src="/api/reference-image/${encodeURIComponent(r.id)}" alt=""/><div>${r.name}</div>`;
    container.appendChild(item);
  });
}

async function init() {
  try {
    const refsData = await api("/api/references");
    references = (refsData && refsData.references) || [];
    renderGlobalRefs();
    
    await loadMishnayotList();
  } catch (e) {
    setStatus("שגיאת אתחול: " + e.message, "err");
  }
}

async function loadMishnayotList(selectId = null) {
  const list = await api("/api/mishnayot");
  const sel = $("#mishnaSelect");
  if (!sel) return;
  sel.innerHTML = "";

  list.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.mishna_id;
    opt.textContent = m.title + (m.has_srt ? "" : " (אין SRT)") + (m.has_project ? " ✓" : "");
    sel.appendChild(opt);
  });
  
  if (selectId) {
    sel.value = selectId;
    currentMishna = selectId;
    await loadProject();
  } else if (list.length) {
    currentMishna = list[0].mishna_id;
    await loadProject();
  }
}

async function loadProject() {
  const sel = $("#mishnaSelect");
  currentMishna = (sel && sel.value) || currentMishna;
  if (!currentMishna) return;
  
  setStatus("טוען...");
  try {
    project = await api(`/api/project/${encodeURIComponent(currentMishna)}`);
    const ipm = $("#ipm");
    if (ipm) ipm.value = project.images_per_minute || 4;
    
    const audioContainer = $("#audioUploadContainer");
    if (!project.audio_path) {
      if (audioContainer) audioContainer.style.display = "flex";
      audio.src = "";
    } else {
      if (audioContainer) audioContainer.style.display = "none";
      audio.src = `/api/project/${encodeURIComponent(currentMishna)}/audio?t=${Date.now()}`;
    }
    
    // Load director instructions if any
    const dirText = $("#directorInstructionsText");
    if (dirText) dirText.value = project.director_instructions || "";
    
    renderTimeline();
    setStep(inferStep());
    
    const totalScenes = (project.slots || []).reduce((sum, m) => sum + (m.scenes || []).length, 0);
    setStatus(`${project.slots.length} דקות, ${totalScenes} סצנות`, "ok");
  } catch (e) {
    setStatus("שגיאה בטעינה: " + e.message, "err");
  }
}

function renderTimeline() {
  const tel = $("#timeline");
  if (!tel) return;
  tel.innerHTML = "";
  
  if (!project || !project.slots || project.slots.length === 0) {
    tel.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--muted);">אין סצנות עדיין.</div>';
    return;
  }
  
  const minuteTemplate = $("#minuteCardTemplate");
  if (!minuteTemplate) return;
  
  project.slots.forEach((minuteSlot) => {
    const minuteNode = minuteTemplate.content.cloneNode(true);
    const minuteRoot = $(".minute-card", minuteNode);
    
    const title = $(".minute-title", minuteRoot);
    // If it's the "full project" slot, title it accordingly
    if (title) {
        if (minuteSlot.id === "full-project-slot") {
            title.textContent = `כל הסצנות`;
        } else {
            title.textContent = `דקה ${minuteSlot.minute_index + 1}`;
        }
    }
    
    const timeRange = $(".minute-time-range", minuteRoot);
    if (timeRange) timeRange.textContent = `${minuteSlot.start} → ${minuteSlot.end}`;
    
    const scenesGrid = $(".scenes-grid", minuteRoot);
    if (scenesGrid) {
      (minuteSlot.scenes || []).forEach((scene, idx) => {
        scenesGrid.appendChild(renderScene(minuteSlot.id, scene, idx + 1));
      });
    }
    
    tel.appendChild(minuteNode);
  });
}

function renderScene(minuteId, scene, sceneNumber) {
  const tpl = $("#sceneTemplate");
  if (!tpl) return document.createElement("div");
  const node = tpl.content.cloneNode(true);
  const root = $(".scene-card", node);
  root.dataset.minuteId = minuteId;
  root.dataset.sceneId = scene.scene_id;

  const numberEl = $(".scene-number", root);
  if (numberEl) numberEl.textContent = `סצנה ${sceneNumber}`;
  
  const timeEl = $(".scene-time", root);
  if (timeEl) timeEl.textContent = scene.start && scene.end ? `${scene.start} → ${scene.end}` : "";
  
  const badge = $(".scene-status-badge", root);
  if (badge) {
    badge.textContent = statusLabel(scene.status);
    badge.className = "scene-status-badge " + scene.status;
  }

  const mishnaText = $(".mishna-text", root);
  if (mishnaText) {
    mishnaText.value = scene.mishna_text || "";
    mishnaText.onchange = () => saveScene(minuteId, scene.scene_id, root);
  }
  
  const promptText = $(".prompt-text", root);
  if (promptText) {
    promptText.value = scene.prompt || "";
    promptText.onchange = () => saveScene(minuteId, scene.scene_id, root);
  }
  
  const chipsContainer = $(".ref-chips-container", root);
  if (chipsContainer) renderChips(chipsContainer, scene.references || []);

  const img = $(".scene-image", root);
  if (img && scene.image_path) {
    img.src = `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${scene.scene_id}/image?t=${Date.now()}`;
    img.classList.add("has");
  }
  
  const aiBtn = $(".ai-prompt-btn", root);
  if (aiBtn) aiBtn.onclick = () => askClaudeSingle(minuteId, scene.scene_id, root);

  const saveBtn = $(".save-scene-btn", root);
  if (saveBtn) saveBtn.onclick = () => saveScene(minuteId, scene.scene_id, root);
  
  const editRefsBtn = $(".edit-refs-btn", root);
  if (editRefsBtn) editRefsBtn.onclick = () => openRefModal(minuteId, scene.scene_id);
  
  const genBtn = $(".generate-btn", root);
  if (genBtn) genBtn.onclick = () => generateScene(minuteId, scene.scene_id);
  
  const approveBtn = $(".approve-btn", root);
  if (approveBtn) approveBtn.onclick = () => approveScene(minuteId, scene.scene_id);

  return node;
}

function statusLabel(s) {
  return {
    proposed: "מוצע",
    approved: "מאושר",
    needs_regen: "ליצירה מחדש",
    image_ready: "תמונה מוכנה",
    image_approved: "מאושר ✓",
  }[s] || s;
}

function renderChips(container, refs) {
  if (!container) return;
  container.innerHTML = "";
  if (!refs || refs.length === 0) {
    container.innerHTML = '<span style="font-size: 11px; color: var(--muted);">אין רפרנסים</span>';
    return;
  }
  refs.forEach((r) => {
    const meta = references.find((x) => x.id === r || x.file === r);
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = meta ? meta.name : r;
    container.appendChild(span);
  });
}

function findMinuteSlot(minuteId) {
  return (project.slots || []).find((m) => m.id === minuteId);
}

function findScene(minuteId, sceneId) {
  const minute = findMinuteSlot(minuteId);
  if (!minute) return null;
  return (minute.scenes || []).find((s) => s.scene_id === sceneId);
}

function findSceneCard(minuteId, sceneId) {
  return $(`.scene-card[data-minute-id="${minuteId}"][data-scene-id="${sceneId}"]`);
}

async function askClaudeSingle(minuteId, sceneId, root) {
  const instruction = prompt("הכנס הנחיה ל-Claude לתיקון ה-Prompt (או השאר ריק ליצירה מחדש רגילה):");
  if (instruction === null) return; // cancelled
  
  setStatus(`מבקש מ-Claude עבור סצנה ${sceneId}...`);
  try {
    const updated = await api(
      `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/repropose`,
      { method: "POST", body: JSON.stringify({ instruction }) }
    );
    
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    
    const promptText = $(".prompt-text", root);
    if (promptText) promptText.value = updated.prompt || "";
    
    const cCont = $(".ref-chips-container", root);
    if (cCont) renderChips(cCont, updated.references || []);
    
    const badge = $(".scene-status-badge", root);
    if (badge) {
      badge.textContent = statusLabel(updated.status);
      badge.className = "scene-status-badge " + updated.status;
    }
    
    setStatus("עודכן בהצלחה מ-Claude ✓", "ok");
  } catch (e) {
    setStatus("שגיאת Claude: " + e.message, "err");
  }
}

async function saveScene(minuteId, sceneId, root) {
  const scene = findScene(minuteId, sceneId);
  if (!scene) return;
  
  const body = {
    mishna_text: $(".mishna-text", root).value,
    prompt: $(".prompt-text", root).value,
  };
  
  try {
    const updated = await api(
      `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}`,
      { method: "PUT", body: JSON.stringify(body) }
    );
    Object.assign(scene, updated);
    setStatus("נשמר ✓", "ok");
  } catch (e) {
    setStatus("שגיאה בשמירה: " + e.message, "err");
  }
}

async function generateScene(minuteId, sceneId) {
  setStatus(`יוצר תמונה ל-${sceneId}...`);
  try {
    const updated = await api(
      `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/generate`,
      { method: "POST", body: JSON.stringify({}) }
    );
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    
    const card = findSceneCard(minuteId, sceneId);
    if (card) {
      const img = $(".scene-image", card);
      if (img) {
        img.src = `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/image?t=${Date.now()}`;
        img.classList.add("has");
      }
      const badge = $(".scene-status-badge", card);
      if (badge) {
        badge.textContent = statusLabel(updated.status);
        badge.className = "scene-status-badge " + updated.status;
      }
    }
    setStatus("תמונה נוצרה ✓", "ok");
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  }
}

async function approveScene(minuteId, sceneId) {
  try {
    const updated = await api(
      `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/approve`,
      { method: "POST", body: JSON.stringify({}) }
    );
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    
    const card = findSceneCard(minuteId, sceneId);
    if (card) {
      const badge = $(".scene-status-badge", card);
      if (badge) {
        badge.textContent = statusLabel(updated.status);
        badge.className = "scene-status-badge " + updated.status;
      }
    }
    setStatus("אושר ✓", "ok");
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  }
}

function openRefModal(minuteId, sceneId) {
  refModalMinuteId = minuteId;
  refModalSceneId = sceneId;
  const scene = findScene(minuteId, sceneId);
  const selected = new Set(scene.references || []);
  const grid = $("#refGrid");
  if (!grid) return;
  grid.innerHTML = "";
  references.forEach((r) => {
    const item = document.createElement("div");
    item.className = "ref-item" + (selected.has(r.id) ? " sel" : "");
    item.dataset.id = r.id;
    item.innerHTML = `<img src="/api/reference-image/${encodeURIComponent(r.id)}" alt=""/><div>${r.name}</div>`;
    item.onclick = () => item.classList.toggle("sel");
    grid.appendChild(item);
  });
  if ($("#refModal")) $("#refModal").classList.remove("hidden");
}

const rsBtn = $("#refSave");
if (rsBtn) {
  rsBtn.onclick = async () => {
    const chosen = $$("#refGrid .ref-item.sel").map((el) => el.dataset.id);
    try {
      const updated = await api(
        `/api/project/${encodeURIComponent(currentMishna)}/minute/${refModalMinuteId}/scene/${refModalSceneId}`,
        { method: "PUT", body: JSON.stringify({ references: chosen }) }
      );
      const scene = findScene(refModalMinuteId, refModalSceneId);
      if (scene) Object.assign(scene, updated);
      
      const card = findSceneCard(refModalMinuteId, refModalSceneId);
      if (card) {
        const cCont = $(".ref-chips-container", card);
        if (cCont) renderChips(cCont, updated.references || []);
      }
      setStatus("רפרנסים עודכנו ✓", "ok");
    } catch (e) {
      setStatus("שגיאה: " + e.message, "err");
    }
    if ($("#refModal")) $("#refModal").classList.add("hidden");
  };
}

const rcBtn = $("#refCancel");
if (rcBtn) {
  rcBtn.onclick = () => {
    if ($("#refModal")) $("#refModal").classList.add("hidden");
  };
}

const mSelect = $("#mishnaSelect");
if (mSelect) mSelect.onchange = loadProject;

// העלאת אודיו
const uabBtn = $("#uploadAudioBtn");
if (uabBtn) {
  uabBtn.onclick = async () => {
    const fileInput = $("#projectAudio");
    if (!fileInput.files.length) {
      alert("יש לבחור קובץ אודיו");
      return;
    }
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    setStatus("מעלה אודיו...");
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/audio`, {
        method: "POST",
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      project.audio_path = data.audio_path;
      $("#audioUploadContainer").style.display = "none";
      audio.src = `/api/project/${encodeURIComponent(currentMishna)}/audio?t=${Date.now()}`;
      setStatus("אודיו הועלה בהצלחה ✓", "ok");
    } catch(e) {
      setStatus("שגיאה בהעלאת אודיו: " + e.message, "err");
    }
  };
}

// הזרמת הצעת Claude
// הוראות במאי ופרומפט
$("#directorInstructionsBtn").onclick = () => {
  $("#directorModal").classList.remove("hidden");
};
$("#dirCancel").onclick = () => $("#directorModal").classList.add("hidden");
$("#dirSave").onclick = async () => {
  const txt = $("#directorInstructionsText").value.trim();
  setStatus("שומר הוראות במאי...");
  try {
    await api(`/api/project/${encodeURIComponent(currentMishna)}`, {
      method: "PUT",
      body: JSON.stringify({ director_instructions: txt })
    });
    project.director_instructions = txt;
    $("#directorModal").classList.add("hidden");
    setStatus("הוראות נשמרו ✓", "ok");
  } catch(e) {
    setStatus("שגיאה: " + e.message, "err");
  }
};

$("#showPromptBtn").onclick = async () => {
  setStatus("טוען פרומפט לדוגמה...");
  try {
    const res = await api(`/api/project/${encodeURIComponent(currentMishna)}/prompt-preview`);
    $("#previewPromptText").value = res.prompt;
    $("#showPromptModal").classList.remove("hidden");
    setStatus("פרומפט נטען ✓", "ok");
  } catch(e) {
    setStatus("שגיאה: " + e.message, "err");
  }
};

$("#savePromptBtn").onclick = async () => {
  const customPrompt = $("#previewPromptText").value.trim();
  $("#showPromptModal").classList.add("hidden");
  
  const ipmInput = $("#ipm");
  const ipm = parseFloat(ipmInput ? ipmInput.value : 4) || 4;

  setStatus("Claude ממלא סצנות עם הפרומפט המעודכן...");
  try {
    const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/propose-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images_per_minute: ipm, custom_prompt: customPrompt }),
    });
    if (!res.ok || !res.body) throw new Error(res.statusText || "stream נכשל");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let filled = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.type === "minute") {
          const minute = ev.minute;
          const existing = findMinuteSlot(minute.id);
          if (existing) {
            Object.assign(existing, minute);
          } else {
              project.slots = [minute];
          }
          filled++;
          setStatus(`הסצנות נוצרו! מעדכן תצוגה...`);
        }
      }
    }
    renderTimeline();
    setStatus("Claude סיים למלא את הסצנות ✓", "ok");
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  }
};

$("#closePromptBtn").onclick = () => $("#showPromptModal").classList.add("hidden");

// פרויקט חדש
$("#newProjectBtn").onclick = () => {
  $("#npId").value = "";
  $("#npPlot").value = "";
  $("#npSrt").value = "";
  $("#newProjectModal").classList.remove("hidden");
};
$("#npCancel").onclick = () => $("#newProjectModal").classList.add("hidden");
$("#npSave").onclick = async () => {
  const mishna_id = $("#npId").value.trim();
  const plot = $("#npPlot").value.trim();
  const srt_text = $("#npSrt").value.trim();
  const ipm = parseInt($("#npIpm").value) || 4;
  
  if (!mishna_id || !srt_text) {
    alert("חובה להזין מזהה פרויקט ו-SRT");
    return;
  }
  
  setStatus("יוצר פרויקט חדש...");
  try {
    await api("/api/project/create", {
      method: "POST",
      body: JSON.stringify({ mishna_id, plot, srt_text, images_per_minute: ipm })
    });
    $("#newProjectModal").classList.add("hidden");
    setStatus("פרויקט נוצר בהצלחה ✓", "ok");
    await loadMishnayotList(mishna_id);
  } catch(e) {
    setStatus("שגיאה ביצירת פרויקט: " + e.message, "err");
  }
};

// רפרנס חדש
$("#uploadRefBtn").onclick = () => {
  $("#urFile").value = "";
  $("#urName").value = "";
  $("#urDesc").value = "";
  $("#uploadRefModal").classList.remove("hidden");
};
$("#urCancel").onclick = () => $("#uploadRefModal").classList.add("hidden");
$("#urSave").onclick = async () => {
  const fileInput = $("#urFile");
  if (!fileInput.files.length) {
    alert("יש לבחור קובץ תמונה");
    return;
  }
  
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("name", $("#urName").value.trim());
  fd.append("description", $("#urDesc").value.trim());
  fd.append("category", $("#urCat").value);
  
  setStatus("מעלה רפרנס...");
  try {
    const res = await fetch("/api/references", {
      method: "POST",
      body: fd
    });
    if (!res.ok) throw new Error(await res.text());
    
    const newRef = await res.json();
    references.push(newRef);
    renderGlobalRefs();
    $("#uploadRefModal").classList.add("hidden");
    setStatus("רפרנס הועלה ✓", "ok");
  } catch(e) {
    setStatus("שגיאה בהעלאת רפרנס: " + e.message, "err");
  }
};

async function runProposeStream() {
  const ipmInput = $("#ipm");
  const ipm = parseFloat(ipmInput ? ipmInput.value : 4) || 4;

  setStatus("Claude ממלא סצנות...");
  const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/propose-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images_per_minute: ipm }),
  });
  if (!res.ok || !res.body) throw new Error(res.statusText || "stream נכשל");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let filled = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch (e) { continue; }
      if (ev.type === "minute") {
        const minute = ev.minute;
        const existing = findMinuteSlot(minute.id);
        if (existing) {
          Object.assign(existing, minute);
        } else {
            // New slot (like "full-project-slot")
            project.slots = [minute];
        }
        filled++;
        setStatus(`הסצנות נוצרו! מעדכן תצוגה...`);
      }
    }
  }
  // רנדר מחדש אחרי שכל הדקות התמלאו
  renderTimeline();
  setStatus("Claude סיים למלא את הסצנות ✓", "ok");
}

async function runGenerateAll() {
  let count = 0;
  for (const minute of project.slots || []) {
    for (const scene of minute.scenes || []) {
      if (!scene.image_path) {
        try {
          await generateScene(minute.id, scene.scene_id);
          count++;
        } catch (e) {
          console.error(e);
        }
      }
    }
  }
  setStatus(`נוצרו ${count} תמונות ✓`, "ok");
}

async function runBuild() {
  setStatus("מרכיב...");
  await api(`/api/project/${encodeURIComponent(currentMishna)}/build`, { method: "POST" });
  const vPanel = $("#videoPanel");
  if (vPanel) vPanel.classList.remove("hidden");
  const rVid = $("#resultVideo");
  if (rVid) rVid.src = `/api/project/${encodeURIComponent(currentMishna)}/video?t=${Date.now()}`;
  setStatus("הוידאו הורכב ✓", "ok");
}

const nextBtn = $("#nextStepBtn");
if (nextBtn) {
  nextBtn.onclick = async () => {
    nextBtn.disabled = true;
    try {
      if (currentStep === "transcription") {
        await runProposeStream();
        setStep("content");
      } else if (currentStep === "content") {
        await runGenerateAll();
        setStep("images");
      } else if (currentStep === "images") {
        await runBuild();
        setStep("video");
      }
    } catch (e) {
      setStatus("שגיאה: " + e.message, "err");
    } finally {
      if (currentStep !== "video") nextBtn.disabled = false;
    }
  };
}

const pBtn = $("#proposeBtn");
if (pBtn) {
  pBtn.onclick = async () => {
    try { await runProposeStream(); setStep("content"); }
    catch (e) { setStatus("שגיאה: " + e.message, "err"); }
  };
}

const gaBtn = $("#generateAllBtn");
if (gaBtn) {
  gaBtn.onclick = async () => {
    try { await runGenerateAll(); setStep("images"); }
    catch (e) { setStatus("שגיאה: " + e.message, "err"); }
  };
}

const bBtn = $("#buildBtn");
if (bBtn) {
  bBtn.onclick = async () => {
    try { await runBuild(); setStep("video"); }
    catch (e) { setStatus("שגיאה: " + e.message, "err"); }
  };
}

window.addEventListener("DOMContentLoaded", init);
