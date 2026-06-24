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

function getNewRefs() {
  if (!project) return [];
  const slot = (project.slots || []).find((s) => s.id === COMIC_SLOT_ID);
  return slot ? slot.new_references || [] : [];
}

// ---------- רפרנסים חדשים שהוצעו ע"י Claude ----------
function renderProposedRefs(root) {
  const proposed = getNewRefs();
  if (proposed.length === 0) return;

  const section = document.createElement("section");
  section.className = "proposed-refs-section";
  section.innerHTML = `
    <h3 class="proposed-refs-title">🆕 דמויות/מקומות חדשים שהוצעו — ייצר ואשר לפני יצירת התמונות</h3>
    <div class="proposed-refs-grid"></div>`;
  const grid = section.querySelector(".proposed-refs-grid");

  proposed.forEach((ref) => grid.appendChild(buildProposedRefCard(ref)));
  root.appendChild(section);
}

function buildProposedRefCard(ref) {
  const card = document.createElement("article");
  card.className = "panel-card proposed-ref-card";

  const existing = references.find((r) => r.name === ref.name);
  card.innerHTML = `
    <div class="panel-header">
      <span class="panel-number">${categoryLabel(ref.category)}</span>
      <span class="scene-status-badge">${existing ? "קיים באינדקס" : "מוצע"}</span>
    </div>
    <div class="panel-image-preview ${existing ? "has-image" : ""}">
      ${existing ? `<img src="/api/reference-image/${encodeURIComponent(existing.id)}" alt="" />` : ""}
      <div class="no-image-placeholder"><span>🖼️</span></div>
    </div>
    <div class="scene-section">
      <label class="section-label">שם</label>
      <input class="pr-name" type="text" value="${escapeAttr(ref.name || "")}" />
    </div>
    <div class="scene-section">
      <label class="section-label">תיאור ויזואלי</label>
      <textarea class="pr-desc" rows="3">${escapeHtml(ref.description || "")}</textarea>
    </div>
    <div class="scene-controls">
      <button class="pr-generate primary small-btn">🎨 ייצר רפרנס</button>
      <button class="pr-approve secondary small-btn">✓ אשר</button>
    </div>`;

  card.querySelector(".pr-generate").addEventListener("click", async () => {
    setStatus(`מייצר רפרנס: ${card.querySelector(".pr-name").value}...`);
    try {
      const res = await api(`/api/project/${encodeURIComponent(currentComic)}/create-reference-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: card.querySelector(".pr-name").value,
          description: card.querySelector(".pr-desc").value,
          category: ref.category || "characters",
          age: ref.age,
          height: ref.height,
        }),
      });
      references.push(res);
      removeNewRef(ref.id);
      renderGlobalRefs();
      renderPanels();
      setStatus(`הרפרנס "${res.name}" נוצר ונוסף לאינדקס ✓`, "ok");
    } catch (e) {
      setStatus("שגיאה ביצירת רפרנס: " + e.message, "err");
    }
  });

  card.querySelector(".pr-approve").addEventListener("click", () => {
    removeNewRef(ref.id);
    renderPanels();
    setStatus("הרפרנס אושר", "ok");
  });

  return card;
}

function removeNewRef(id) {
  (project.slots || []).forEach((s) => {
    if (s.new_references) s.new_references = s.new_references.filter((r) => r.id !== id);
  });
}

function categoryLabel(cat) {
  return { characters: "דמות חדשה", style: "מקום חדש", items: "חפץ חדש" }[cat] || "רפרנס חדש";
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
  renderPanelsInner();
  renderPreviewSidebar();
}

function renderPanelsInner() {
  const root = $("#panels");
  root.innerHTML = "";
  if (!project) {
    root.innerHTML = `<p class="empty-hint">בחר קומיקס או צור חדש כדי להתחיל.</p>`;
    return;
  }
  renderProposedRefs(root);

  const panels = getPanels();
  if (panels.length === 0) {
    if (!getNewRefs().length) {
      root.innerHTML = `<p class="empty-hint">אין עדיין פאנלים. לחץ "פרק לפאנלים (Claude)" כדי לייצר.</p>`;
    }
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
    node.querySelector(".panel-size").value = panel.size || "regular";
    node.querySelector(".panel-shape").value = panel.shape || "rect";

    renderStatusBadge(node.querySelector(".scene-status-badge"), panel.status);
    renderRefChips(node.querySelector(".ref-chips-container"), panel.references || []);
    renderDialogueEditor(node.querySelector(".dialogue-list"), panel.dialogue || []);

    // תמונה + בועות
    const preview = node.querySelector(".panel-image-preview");
    preview.classList.add("shape-" + (panel.shape || "rect"));
    const img = node.querySelector(".panel-image");
    if (panel.image_path) {
      preview.classList.add("has-image");
      img.src = `/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${panel.scene_id}/image?t=${Date.now()}`;
    }
    renderBubbles(node.querySelector(".panel-bubbles"), panel.dialogue || [], panel.caption || "");

    // שינוי גודל/צורה — שמירה אוטומטית ורענון תצוגה מקדימה
    node.querySelector(".panel-size").addEventListener("change", () => savePanelLayout(panel.scene_id, card));
    node.querySelector(".panel-shape").addEventListener("change", () => savePanelLayout(panel.scene_id, card));

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
    let searchId = value, searchName = null;
    if (value.includes("|")) {
      const parts = value.split("|");
      searchId = parts[0].trim();
      searchName = (parts[1] || "").trim();
    }
    const meta = references.find(
      (x) => x.id === searchId || x.name === searchId || x.file === searchId ||
             (searchName && (x.id === searchName || x.name === searchName || x.file === searchName))
    );
    const chip = document.createElement("span");
    if (searchId === "scene:previous") {
      chip.className = "chip scene-ref";
      chip.textContent = "📸 סצנה קודמת";
    } else if (meta) {
      chip.className = "chip";
      chip.textContent = meta.name;
    } else {
      chip.className = "chip missing";
      chip.textContent = `⚠️ ${searchName || searchId}`;
      chip.title = "רפרנס חסר במאגר";
    }
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
  // קריינות תמיד למעלה, בועות דיבור למטה
  const top = document.createElement("div");
  top.className = "bubbles-top";
  const bottom = document.createElement("div");
  bottom.className = "bubbles-bottom";

  if (caption) {
    const cap = document.createElement("div");
    cap.className = "comic-caption";
    cap.textContent = caption;
    top.appendChild(cap);
  }
  dialogue.forEach((d) => {
    if (!d.text) return;
    const b = document.createElement("div");
    b.className = "comic-bubble";
    b.innerHTML = (d.speaker ? `<span class="bubble-speaker">${escapeHtml(d.speaker)}</span>` : "") + escapeHtml(d.text);
    bottom.appendChild(b);
  });

  container.appendChild(top);
  container.appendChild(bottom);
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
    size: card.querySelector(".panel-size").value,
    shape: card.querySelector(".panel-shape").value,
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

// שמירת גודל/צורה בלבד (אגב שינוי בורר) — מעדכן מקומית, שומר ומרענן תצוגה מקדימה
async function savePanelLayout(sceneId, card) {
  const size = card.querySelector(".panel-size").value;
  const shape = card.querySelector(".panel-shape").value;
  // עדכון מקומי מיידי לתצוגה חלקה
  const panel = getPanels().find((p) => p.scene_id === sceneId);
  if (panel) { panel.size = size; panel.shape = shape; }
  const preview = card.querySelector(".panel-image-preview");
  preview.className = preview.className.replace(/shape-\S+/g, "").trim() + " shape-" + shape;
  renderPreviewSidebar();
  try {
    await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size, shape }),
    });
    setStatus("פריסה עודכנה ✓", "ok");
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  }
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

  // מתג תצוגה + ייצוא
  $("#viewEditBtn").addEventListener("click", () => showView("edit"));
  $("#viewLayoutBtn").addEventListener("click", () => showView("layout"));
  $("#downloadPdfBtn").addEventListener("click", downloadPdf);
  $("#downloadPngBtn").addEventListener("click", downloadPngs);

  // סרגל תצוגה מקדימה
  $("#togglePreviewBtn").addEventListener("click", () => togglePreview(false));
  $("#showPreviewBtn").addEventListener("click", () => togglePreview(true));
}

// ---------- עיצוב עמוד (פריסה + ייצוא) ----------
const PAGE_COLS = 2;
const PAGE_ROWS = 4;

const SIZE_DIMS = {
  regular: { w: 1, h: 1 },
  wide: { w: 2, h: 1 },
  tall: { w: 1, h: 2 },
  big: { w: 2, h: 2 },
};

function paginate(panels) {
  const pages = [];
  let grid = null;
  let placements = null;

  const newPage = () => {
    grid = Array.from({ length: PAGE_ROWS }, () => Array(PAGE_COLS).fill(false));
    placements = [];
    pages.push(placements);
  };

  const fits = (row, col, w, h) => {
    if (col + w > PAGE_COLS || row + h > PAGE_ROWS) return false;
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++) if (grid[r][c]) return false;
    return true;
  };
  const occupy = (row, col, w, h) => {
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++) grid[r][c] = true;
  };
  const findSpot = (w, h) => {
    for (let r = 0; r < PAGE_ROWS; r++)
      for (let c = 0; c < PAGE_COLS; c++) if (fits(r, c, w, h)) return { row: r, col: c };
    return null;
  };

  newPage();
  panels.forEach((panel) => {
    const { w, h } = SIZE_DIMS[panel.size] || SIZE_DIMS.regular;
    let spot = findSpot(w, h);
    if (!spot) {
      newPage();
      spot = findSpot(w, h) || { row: 0, col: 0 };
    }
    occupy(spot.row, spot.col, w, h);
    placements.push({ panel, ...spot, w, h });
  });

  return pages;
}

function buildPagesInto(container, emptyMsg) {
  container.innerHTML = "";
  const panels = getPanels();
  if (!project || panels.length === 0) {
    if (emptyMsg) container.innerHTML = `<p class="empty-hint">${emptyMsg}</p>`;
    return;
  }
  const pages = paginate(panels);
  pages.forEach((placements) => {
    const page = document.createElement("div");
    page.className = "comic-page";
    placements.forEach(({ panel, row, col, w, h }) => {
      const cell = document.createElement("div");
      cell.className = "page-panel size-" + (panel.size || "regular") + " shape-" + (panel.shape || "rect");
      cell.style.gridColumn = `${col + 1} / span ${w}`;
      cell.style.gridRow = `${row + 1} / span ${h}`;

      if (panel.image_path) {
        const img = document.createElement("img");
        img.crossOrigin = "anonymous";
        img.src = `/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${panel.scene_id}/image?t=${Date.now()}`;
        cell.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "no-image-placeholder";
        ph.innerHTML = "<span>🖼️</span>";
        cell.appendChild(ph);
      }

      const bubbles = document.createElement("div");
      bubbles.className = "panel-bubbles";
      renderBubbles(bubbles, panel.dialogue || [], panel.caption || "");
      cell.appendChild(bubbles);

      page.appendChild(cell);
    });
    container.appendChild(page);
  });
}

function renderPages() {
  buildPagesInto($("#pagesContainer"), 'אין פאנלים להציג. חזור ל"עריכה" וצור פאנלים תחילה.');
}

function renderPreviewSidebar() {
  const sidebar = $("#previewSidebar");
  if (!sidebar || sidebar.classList.contains("collapsed")) return;
  buildPagesInto($("#previewPages"), "אין עדיין פאנלים.");
}

function togglePreview(show) {
  const sidebar = $("#previewSidebar");
  const collapsed = show === undefined ? !sidebar.classList.contains("collapsed") : !show;
  sidebar.classList.toggle("collapsed", collapsed);
  $("#showPreviewBtn").classList.toggle("hidden", !collapsed);
  if (!collapsed) renderPreviewSidebar();
}

function showView(view) {
  const layout = view === "layout";
  $("#editArea").classList.toggle("hidden", layout);
  $("#pagesView").classList.toggle("hidden", !layout);
  $("#viewEditBtn").className = layout ? "secondary" : "primary";
  $("#viewLayoutBtn").className = layout ? "primary" : "secondary";
  if (layout) renderPages();
  else renderPreviewSidebar();
}

async function waitForImages(el) {
  const imgs = $$("img", el);
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth
        ? Promise.resolve()
        : new Promise((res) => {
            img.onload = res;
            img.onerror = res;
          })
    )
  );
}

async function renderPageCanvas(pageEl) {
  await waitForImages(pageEl);
  return html2canvas(pageEl, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
}

async function downloadPdf() {
  const pages = $$(".comic-page", $("#pagesContainer"));
  if (pages.length === 0) return;
  setExport("מכין PDF...");
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210, H = 297;
    for (let i = 0; i < pages.length; i++) {
      setExport(`מעבד עמוד ${i + 1}/${pages.length}...`);
      const canvas = await renderPageCanvas(pages[i]);
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, W, H);
    }
    pdf.save(`${currentComic || "comic"}.pdf`);
    setExport("PDF הורד ✓");
  } catch (e) {
    setExport("שגיאה: " + e.message);
  }
}

async function downloadPngs() {
  const pages = $$(".comic-page", $("#pagesContainer"));
  if (pages.length === 0) return;
  setExport("מכין PNG...");
  try {
    for (let i = 0; i < pages.length; i++) {
      setExport(`מעבד עמוד ${i + 1}/${pages.length}...`);
      const canvas = await renderPageCanvas(pages[i]);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${currentComic || "comic"}-page-${i + 1}.png`;
      a.click();
      await new Promise((r) => setTimeout(r, 300));
    }
    setExport("PNG הורד ✓");
  } catch (e) {
    setExport("שגיאה: " + e.message);
  }
}

function setExport(msg) {
  $("#exportStatus").textContent = msg || "";
}

async function init() {
  bindEvents();
  await loadReferences();
  await loadComicsList();
  await loadComic($("#comicSelect").value);
}

init();
