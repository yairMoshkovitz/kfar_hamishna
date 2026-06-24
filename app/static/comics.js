"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const COMIC_SLOT_ID = "comic-slot";

let currentComic = null;   // mishna_id
let project = null;
let references = [];
let refModalSceneId = null;

function setStatus(msg, kind = "") {
  const el = $("#status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

const api = (path, opts) =>
  fetch(path, opts).then(async (r) => {
    if (!r.ok) {
      let detail = r.statusText;
      try { detail = (await r.json()).detail || detail; } catch (e) {}
      throw new Error(detail);
    }
    return r.json();
  });

function getPanels() {
  if (!project) return [];
  const slot = (project.slots || []).find((s) => s.id === COMIC_SLOT_ID);
  return slot ? slot.scenes || [] : [];
}

// ---------- רשימת קומיקסים ----------
async function loadComicsList() {
  const all = await api("/api/mishnayot");
  const comics = all.filter((m) => m.mode === "comics");
  const sel = $("#comicSelect");
  sel.innerHTML = "";
  if (comics.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "— אין קומיקסים, צור חדש —";
    opt.value = "";
    sel.appendChild(opt);
    return;
  }
  for (const c of comics) {
    const opt = document.createElement("option");
    opt.value = c.mishna_id;
    opt.textContent = c.title;
    sel.appendChild(opt);
  }
  if (!currentComic || !comics.find((c) => c.mishna_id === currentComic)) {
    currentComic = comics[0].mishna_id;
  }
  sel.value = currentComic;
}

async function loadComic(id) {
  if (!id) { project = null; renderPanels(); return; }
  currentComic = id;
  project = await api(`/api/project/${encodeURIComponent(id)}`);
  renderPanels();
}

// ---------- רפרנסים ----------
async function loadReferences() {
  const data = await api("/api/references");
  references = data.references || [];
  renderGlobalRefs();
}

function renderGlobalRefs() {
  const container = $("#globalRefsList");
  container.innerHTML = "";
  for (const r of references) {
    if (r.dormant) continue;
    const div = document.createElement("div");
    div.className = "ref-item";
    div.innerHTML = `
      <img src="/api/reference-image/${encodeURIComponent(r.id)}" alt="" loading="lazy" />
      <span>${r.name || r.id}</span>`;
    container.appendChild(div);
  }
}

function refLabel(value) {
  if (value && value.includes("|")) return value.split("|")[1] || value.split("|")[0];
  const r = references.find((x) => x.id === value || x.name === value);
  return r ? r.name : value;
}

// ---------- רינדור פאנלים ----------
function renderPanels() {
  const root = $("#panels");
  root.innerHTML = "";
  if (!project) {
    root.innerHTML = `<p class="empty-hint">בחר קומיקס או צור חדש כדי להתחיל.</p>`;
    return;
  }
  const panels = getPanels();
  if (panels.length === 0) {
    root.innerHTML = `<p class="empty-hint">אין עדיין פאנלים. לחץ "פרק לפאנלים (Claude)" כדי לייצר.</p>`;
    return;
  }
  const tpl = $("#panelTemplate");
  panels.forEach((panel) => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector(".panel-card");
    card.dataset.sceneId = panel.scene_id;

    node.querySelector(".panel-number").textContent = "פאנל " + (panel.panel_number || "");
    node.querySelector(".panel-location").textContent = panel.location || "";
    node.querySelector(".panel-desc").value = panel.description || "";
    node.querySelector(".location-text").value = panel.location || "";
    node.querySelector(".prompt-text").value = panel.prompt || "";
    node.querySelector(".caption-text").value = panel.caption || "";

    renderStatusBadge(node.querySelector(".scene-status-badge"), panel.status);
    renderRefChips(node.querySelector(".ref-chips-container"), panel.references || []);
    renderDialogueEditor(node.querySelector(".dialogue-list"), panel.dialogue || []);

    // תמונה + בועות
    const preview = node.querySelector(".panel-image-preview");
    const img = node.querySelector(".panel-image");
    if (panel.image_path) {
      preview.classList.add("has-image");
      img.src = `/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${panel.scene_id}/image?t=${Date.now()}`;
    }
    renderBubbles(node.querySelector(".panel-bubbles"), panel.dialogue || [], panel.caption || "");

    // אירועים
    node.querySelector(".generate-btn").addEventListener("click", () => generatePanel(panel.scene_id, card));
    node.querySelector(".approve-btn").addEventListener("click", () => approvePanel(panel.scene_id));
    node.querySelector(".save-scene-btn").addEventListener("click", () => savePanel(panel.scene_id, card));
    node.querySelector(".delete-scene-btn").addEventListener("click", () => deletePanel(panel.scene_id));
    node.querySelector(".edit-refs-btn").addEventListener("click", () => openRefModal(panel.scene_id));
    node.querySelector(".add-dialogue-btn").addEventListener("click", () => {
      addDialogueRow(card.querySelector(".dialogue-list"), "", "");
    });

    root.appendChild(node);
  });
}

function renderStatusBadge(el, status) {
  const map = {
    proposed: ["מוצע", "#888"],
    image_ready: ["תמונה מוכנה", "#2980b9"],
    image_approved: ["אושר", "#27ae60"],
    approved: ["אושר", "#27ae60"],
  };
  const [txt, color] = map[status] || [status || "", "#888"];
  el.textContent = txt;
  el.style.background = color;
}

function renderRefChips(container, refs) {
  container.innerHTML = "";
  refs.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "ref-chip";
    chip.textContent = refLabel(value);
    container.appendChild(chip);
  });
}

function renderDialogueEditor(container, dialogue) {
  container.innerHTML = "";
  dialogue.forEach((d) => addDialogueRow(container, d.speaker || "", d.text || ""));
}

function addDialogueRow(container, speaker, text) {
  const row = document.createElement("div");
  row.className = "dialogue-row";
  row.innerHTML = `
    <input class="dlg-speaker" placeholder="דובר" value="${escapeAttr(speaker)}" />
    <input class="dlg-text" placeholder="טקסט הבועה" value="${escapeAttr(text)}" />
    <button class="dlg-remove danger small-btn">✕</button>`;
  row.querySelector(".dlg-remove").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function collectDialogue(card) {
  return $$(".dialogue-row", card)
    .map((row) => ({
      speaker: row.querySelector(".dlg-speaker").value.trim(),
      text: row.querySelector(".dlg-text").value.trim(),
    }))
    .filter((d) => d.text);
}

function renderBubbles(container, dialogue, caption) {
  container.innerHTML = "";
  if (caption) {
    const cap = document.createElement("div");
    cap.className = "comic-caption";
    cap.textContent = caption;
    container.appendChild(cap);
  }
  dialogue.forEach((d) => {
    if (!d.text) return;
    const b = document.createElement("div");
    b.className = "comic-bubble";
    b.innerHTML = (d.speaker ? `<span class="bubble-speaker">${escapeHtml(d.speaker)}</span>` : "") + escapeHtml(d.text);
    container.appendChild(b);
  });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

// ---------- פעולות פאנל ----------
function panelPayload(card) {
  return {
    description: card.querySelector(".panel-desc").value,
    location: card.querySelector(".location-text").value,
    prompt: card.querySelector(".prompt-text").value,
    caption: card.querySelector(".caption-text").value,
    dialogue: collectDialogue(card),
  };
}

async function savePanel(sceneId, card) {
  setStatus("שומר פאנל...");
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(panelPayload(card)),
  });
  await loadComic(currentComic);
  setStatus("נשמר ✓", "ok");
}

async function generatePanel(sceneId, card) {
  // שומרים קודם כדי שהפרומפט המעודכן יישלח
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(panelPayload(card)),
  });
  setStatus("יוצר תמונה לפאנל...");
  try {
    await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await loadComic(currentComic);
    setStatus("התמונה נוצרה ✓", "ok");
  } catch (e) {
    setStatus("שגיאה ביצירת תמונה: " + e.message, "err");
  }
}

async function approvePanel(sceneId) {
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}/approve`, { method: "POST" });
  await loadComic(currentComic);
  setStatus("אושר ✓", "ok");
}

async function deletePanel(sceneId) {
  if (!confirm("למחוק את הפאנל?")) return;
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}`, { method: "DELETE" });
  await loadComic(currentComic);
  setStatus("נמחק", "ok");
}

// ---------- הצעת פאנלים (Claude) ----------
async function proposePanels(customPrompt) {
  setStatus("Claude מפרק לפאנלים... (עשוי לקחת זמן)");
  try {
    project = await api(`/api/comics/${encodeURIComponent(currentComic)}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customPrompt ? { custom_prompt: customPrompt } : {}),
    });
    renderPanels();
    setStatus(`התקבלו ${getPanels().length} פאנלים ✓`, "ok");
    const mode = $("#workMode").value;
    if (mode === "auto") await generateAll();
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  }
}

async function generateAll() {
  const panels = getPanels();
  for (const p of panels) {
    if (p.image_path) continue;
    setStatus(`יוצר תמונה לפאנל ${p.panel_number}...`);
    try {
      await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${p.scene_id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (e) {
      setStatus(`שגיאה בפאנל ${p.panel_number}: ${e.message}`, "err");
    }
  }
  await loadComic(currentComic);
  setStatus("כל התמונות נוצרו ✓", "ok");
}

// ---------- מודאל רפרנסים ----------
function openRefModal(sceneId) {
  refModalSceneId = sceneId;
  const panel = getPanels().find((p) => p.scene_id === sceneId);
  const selected = new Set(panel ? panel.references || [] : []);
  const grid = $("#refGrid");
  grid.innerHTML = "";
  references.forEach((r) => {
    if (r.dormant) return;
    const value = `${r.id}|${r.name}`;
    const isSel = selected.has(value) || selected.has(r.id);
    const div = document.createElement("div");
    div.className = "ref-grid-item" + (isSel ? " selected" : "");
    div.innerHTML = `
      <img src="/api/reference-image/${encodeURIComponent(r.id)}" alt="" />
      <span>${r.name || r.id}</span>`;
    div.dataset.value = value;
    div.addEventListener("click", () => div.classList.toggle("selected"));
    grid.appendChild(div);
  });
  $("#refModal").classList.remove("hidden");
}

async function saveRefModal() {
  const selected = $$(".ref-grid-item.selected", $("#refGrid")).map((d) => d.dataset.value);
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${refModalSceneId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ references: selected }),
  });
  $("#refModal").classList.add("hidden");
  await loadComic(currentComic);
}

// ---------- אירועים גלובליים ----------
function bindEvents() {
  $("#comicSelect").addEventListener("change", (e) => loadComic(e.target.value));

  // קומיקס חדש
  $("#newComicBtn").addEventListener("click", () => $("#newComicModal").classList.remove("hidden"));
  $("#ncCancel").addEventListener("click", () => $("#newComicModal").classList.add("hidden"));
  $("#ncSave").addEventListener("click", async () => {
    const body = {
      comic_id: $("#ncId").value.trim(),
      title: $("#ncTitle").value.trim(),
      description: $("#ncDesc").value.trim(),
      panels_target: parseInt($("#ncPanels").value) || 6,
    };
    if (!body.comic_id || !body.description) { alert("נא למלא מזהה ותיאור"); return; }
    try {
      const proj = await api("/api/comics/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      $("#newComicModal").classList.add("hidden");
      currentComic = proj.mishna_id;
      await loadComicsList();
      $("#comicSelect").value = currentComic;
      await loadComic(currentComic);
      setStatus("הקומיקס נוצר. כעת לחץ 'פרק לפאנלים'.", "ok");
    } catch (e) {
      alert("שגיאה: " + e.message);
    }
  });

  // עריכת קומיקס
  $("#editComicBtn").addEventListener("click", () => {
    if (!project) return;
    $("#ecDesc").value = project.description || "";
    $("#ecDirector").value = project.director_instructions || "";
    $("#ecStyle").value = project.style_description || "";
    $("#ecPanels").value = project.panels_target || 6;
    $("#editComicModal").classList.remove("hidden");
  });
  $("#ecCancel").addEventListener("click", () => $("#editComicModal").classList.add("hidden"));
  $("#ecSave").addEventListener("click", async () => {
    project = await api(`/api/comics/${encodeURIComponent(currentComic)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: $("#ecDesc").value,
        director_instructions: $("#ecDirector").value,
        style_description: $("#ecStyle").value,
        panels_target: parseInt($("#ecPanels").value) || 6,
      }),
    });
    $("#editComicModal").classList.add("hidden");
    setStatus("נשמר ✓", "ok");
  });

  // פירוק לפאנלים
  $("#proposeBtn").addEventListener("click", () => {
    if (!currentComic) { alert("בחר קומיקס קודם"); return; }
    if (getPanels().length && !confirm("פעולה זו תחליף את הפאנלים הקיימים. להמשיך?")) return;
    proposePanels();
  });
  $("#generateAllBtn").addEventListener("click", () => { if (currentComic) generateAll(); });

  // צפייה בפרומפט
  $("#showPromptBtn").addEventListener("click", async () => {
    if (!currentComic) return;
    const data = await api(`/api/comics/${encodeURIComponent(currentComic)}/prompt-preview`);
    $("#previewPromptText").value = data.prompt;
    $("#showPromptModal").classList.remove("hidden");
  });
  $("#closePromptBtn").addEventListener("click", () => $("#showPromptModal").classList.add("hidden"));
  $("#savePromptBtn").addEventListener("click", () => {
    $("#showPromptModal").classList.add("hidden");
    proposePanels($("#previewPromptText").value);
  });

  // מודאל רפרנסים
  $("#refSave").addEventListener("click", saveRefModal);
  $("#refCancel").addEventListener("click", () => $("#refModal").classList.add("hidden"));
}

async function init() {
  bindEvents();
  await loadReferences();
  await loadComicsList();
  await loadComic($("#comicSelect").value);
}

init();
