"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const COMIC_SLOT_ID = "comic-slot";

// רשת המיקום בתוך הפאנל — חייב להיות זהה ל-comics_brain.GRID_COLS/ROWS וב-main.py
const GRID_COLS = 12;
const GRID_ROWS = 6;
const SVG_NS = "http://www.w3.org/2000/svg";

let currentWorkspace = null; // {id, name}
let currentComic = null;   // mishna_id
let project = null;
let references = [];
let refModalSceneId = null;
let refinedPages = {};     // pageIdx -> { image, withText } — עמודים משופרים ע"י Gemini (לשמירה בין תצוגות)

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
      ${existing ? `<img src="/api/reference-image/${encodeURIComponent(existing.id)}${wsParam()}" alt="" />` : ""}
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
      const res = await api(`/api/project/${encodeURIComponent(currentComic)}/create-reference-image${wsParam()}`, {
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

function wsParam() {
  return currentWorkspace ? `?ws_id=${encodeURIComponent(currentWorkspace.id)}` : "";
}

function wsAmp() {
  return currentWorkspace ? `&ws_id=${encodeURIComponent(currentWorkspace.id)}` : "";
}

function wsQuery(extra = "") {
  const base = currentWorkspace ? `ws_id=${encodeURIComponent(currentWorkspace.id)}` : "";
  return base ? (extra ? `?${base}&${extra}` : `?${base}`) : (extra ? `?${extra}` : "");
}

async function loadWorkspacesList() {
  const list = await api("/api/workspaces");
  const sel = $("#workspaceSelect");
  if (!sel) return;
  sel.innerHTML = "";
  list.forEach(ws => {
    const opt = document.createElement("option");
    opt.value = ws.id;
    opt.textContent = ws.name;
    sel.appendChild(opt);
  });
  const savedId = localStorage.getItem("lastWorkspaceId");
  if (savedId && list.find(w => w.id === savedId)) sel.value = savedId;
  const chosen = list.find(w => w.id === sel.value) || list[0];
  if (chosen) {
    currentWorkspace = chosen;
    sel.value = chosen.id;
    localStorage.setItem("lastWorkspaceId", chosen.id);
  }
}

// ---------- רשימת קומיקסים ----------
async function loadComicsList() {
  const all = await api(`/api/mishnayot${wsParam()}`);
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
  project = await api(`/api/project/${encodeURIComponent(id)}${wsParam()}`);
  // שחזור עמודים משופרים ששמורים בשרת
  refinedPages = {};
  const slot = (project.slots || []).find((s) => s.id === COMIC_SLOT_ID);
  if (slot && slot.refined_pages) {
    for (const [idx, e] of Object.entries(slot.refined_pages)) {
      refinedPages[idx] = {
        image: `/api/project/${encodeURIComponent(id)}/minute/${COMIC_SLOT_ID}/page/${idx}/image?t=${Date.now()}${wsAmp()}`,
        withText: !!e.with_text,
      };
    }
  }
  renderPanels();
}

// ---------- רפרנסים ----------
async function loadReferences() {
  const data = await api(`/api/references${wsParam()}`);
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
      <img src="/api/reference-image/${encodeURIComponent(r.id)}${wsParam()}" alt="" loading="lazy" />
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
    node.querySelector(".sfx-text").value = panel.sfx || "";
    node.querySelector(".panel-size").value = panel.size || "regular";
    node.querySelector(".panel-shape").value = panel.shape || "rect";

    renderStatusBadge(node.querySelector(".scene-status-badge"), panel.status);
    renderRefChips(node.querySelector(".ref-chips-container"), panel.references || []);
    renderDialogueEditor(node.querySelector(".dialogue-list"), panel.dialogue || []);

    // תמונה + בועות
    const preview = node.querySelector(".panel-image-preview");
    // יחס-ממדים אמיתי של הפאנל (כמו בעמוד הסופי) — WYSIWYG למיקומי הבועות
    const dims = panelDims(panel.size);
    preview.style.aspectRatio = dims.w + " / " + dims.h;
    node.querySelector(".panel-clip").classList.add("shape-" + (panel.shape || "rect"));
    const img = node.querySelector(".panel-image");
    if (panel.image_path) {
      preview.classList.add("has-image");
      img.src = `/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${panel.scene_id}/image?t=${Date.now()}${wsAmp()}`;
    }
    const bubblesEl = node.querySelector(".panel-bubbles");
    bubblesEl.style.fontSize = bubbleFontFor(panel.size); // גופן יחסי לרוחב הפאנל — זהה לעמוד
    renderBubbles(bubblesEl, panel.dialogue || [], panel.caption || "", panel.sfx || "");

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
      addDialogueRow(card.querySelector(".dialogue-list"), {});
    });

    root.appendChild(node);
    // גרירה/שינוי-גודל של בועות מעל התמונה (card כבר ב-DOM אחרי append)
    enableBubbleEditing(card);
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

const BUBBLE_KINDS = [
  ["speech", "💬 דיבור"],
  ["thought", "💭 מחשבה"],
  ["shout", "❗ צעקה"],
  ["whisper", "🤫 לחישה"],
];

function renderDialogueEditor(container, dialogue) {
  container.innerHTML = "";
  (dialogue || []).forEach((d) => addDialogueRow(container, d));
}

function addDialogueRow(container, d) {
  d = d || {};
  const row = document.createElement("div");
  row.className = "dialogue-row";
  // שדות מיקום (rect/anchor) שנקבעו ע"י Claude נשמרים ולא הולכים לאיבוד בשמירה ידנית
  if (d.rect) row.dataset.rect = JSON.stringify(d.rect);
  if (d.anchor) row.dataset.anchor = JSON.stringify(d.anchor);
  if (d.tail_points) row.dataset.tailPoints = JSON.stringify(d.tail_points);
  const fontVal = d.font_size || 1;
  const tailVal = d.tail_width || 0.45;
  const opts = BUBBLE_KINDS
    .map(([v, label]) => `<option value="${v}"${(d.kind || "speech") === v ? " selected" : ""}>${label}</option>`)
    .join("");
  row.innerHTML = `
    <input class="dlg-speaker" placeholder="דובר" value="${escapeAttr(d.speaker || "")}" />
    <input class="dlg-text" placeholder="טקסט הבועה" value="${escapeAttr(d.text || "")}" />
    <select class="dlg-kind" title="סוג בועה">${opts}</select>
    <label class="dlg-font" title="גודל כתב בבועה">
      <span class="dlg-font-ico">א</span>
      <input type="range" class="dlg-font-input" min="0.6" max="2" step="0.1" value="${fontVal}" />
      <span class="dlg-font-val">${fontVal.toFixed(1)}</span>
    </label>
    <label class="dlg-tail" title="עובי הזנב">
      <span class="dlg-tail-ico">◣</span>
      <input type="range" class="dlg-tail-input" min="0.15" max="1.1" step="0.05" value="${tailVal}" />
    </label>
    <button class="dlg-remove danger small-btn">✕</button>`;
  row.querySelector(".dlg-remove").addEventListener("click", () => { row.remove(); });
  const fontInput = row.querySelector(".dlg-font-input");
  fontInput.addEventListener("input", () => {
    row.querySelector(".dlg-font-val").textContent = parseFloat(fontInput.value).toFixed(1);
    const card = row.closest(".panel-card");
    if (card) applyFontLive(card);
  });
  fontInput.addEventListener("change", () => {
    const card = row.closest(".panel-card");
    if (card) persistDialogue(card);
  });
  const tailInput = row.querySelector(".dlg-tail-input");
  tailInput.addEventListener("input", () => {
    const card = row.closest(".panel-card");
    if (card) refreshTails(card);
  });
  tailInput.addEventListener("change", () => {
    const card = row.closest(".panel-card");
    if (card) persistDialogue(card);
  });
  container.appendChild(row);
}

function collectDialogue(card) {
  return $$(".dialogue-row", card)
    .map((row) => {
      const d = {
        speaker: row.querySelector(".dlg-speaker").value.trim(),
        text: row.querySelector(".dlg-text").value.trim(),
        kind: row.querySelector(".dlg-kind").value,
      };
      if (row.dataset.rect) try { d.rect = JSON.parse(row.dataset.rect); } catch (e) {}
      if (row.dataset.anchor) try { d.anchor = JSON.parse(row.dataset.anchor); } catch (e) {}
      if (row.dataset.tailPoints) try { d.tail_points = JSON.parse(row.dataset.tailPoints); } catch (e) {}
      const fi = row.querySelector(".dlg-font-input");
      const fv = fi ? parseFloat(fi.value) : 1;
      if (fv && Math.abs(fv - 1) > 0.001) d.font_size = fv;
      const ti = row.querySelector(".dlg-tail-input");
      const tv = ti ? parseFloat(ti.value) : 0.45;
      if (tv && Math.abs(tv - 0.45) > 0.001) d.tail_width = tv;
      return d;
    })
    .filter((d) => d.text);
}

function bubbleInnerHtml(d) {
  return (d.speaker ? `<span class="bubble-speaker">${escapeHtml(d.speaker)}</span>` : "") + escapeHtml(d.text);
}

// מחזיר את 3 קודקודי משולש הזנב (ביחידות רשת 12×6): שני בסיס על שפת הבועה + קצה ב-anchor
// baseHalf — חצי רוחב בסיס הזנב (עובי). ניתן לעקוף לגמרי ע"י d.tail_points (3 קודקודים חופשיים)
function tailTriangle(rect, anchor, baseHalf) {
  const bcx = rect.col + rect.w / 2;
  const bcy = rect.row + rect.h / 2;
  let dx = anchor.col - bcx, dy = anchor.row - bcy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const hw = rect.w / 2, hh = rect.h / 2;
  const sx = Math.abs(dx) < 1e-3 ? Infinity : hw / Math.abs(dx);
  const sy = Math.abs(dy) < 1e-3 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  const ex = bcx + dx * s, ey = bcy + dy * s;
  const px = -dy * baseHalf, py = dx * baseHalf;
  return [
    { col: ex + px, row: ey + py },
    { col: ex - px, row: ey - py },
    { col: anchor.col, row: anchor.row },
  ];
}
// קודקודים → מחרוזת points ל-SVG (viewBox 1200×600)
function pointsToAttr(pts) {
  return pts.map((p) => (p.col * 100).toFixed(1) + "," + (p.row * 100).toFixed(1)).join(" ");
}
function buildTail(rect, anchor, baseHalf) {
  return pointsToAttr(tailTriangle(rect, anchor, baseHalf));
}

// שכבת SVG אחת לכל זנבי הבועות בפאנל (viewBox יחסי לרשת)
function renderTails(container, positioned) {
  const hasPts = (d) => d.tail_points && d.tail_points.length === 3;
  const withAnchor = positioned.filter((d) => d.rect && (d.anchor || hasPts(d)));
  if (!withAnchor.length) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "bubble-tails");
  svg.setAttribute("viewBox", `0 0 ${GRID_COLS * 100} ${GRID_ROWS * 100}`);
  svg.setAttribute("preserveAspectRatio", "none");
  withAnchor.forEach((d) => {
    const tw = d.tail_width || 0.45;
    if (d.kind !== "thought" && hasPts(d)) {
      // זנב עם קודקודים חופשיים שנערכו ידנית
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", pointsToAttr(d.tail_points));
      poly.setAttribute("class", "tail-shape");
      svg.appendChild(poly);
      return;
    }
    if (!d.anchor) return;
    if (d.kind === "thought") {
      // שובל בועות-מחשבה: כמה עיגולים קטֵנים לכיוון הדובר (גודלם לפי עובי הזנב)
      const scale = tw / 0.45;
      const bcx = d.rect.col + d.rect.w / 2, bcy = d.rect.row + d.rect.h / 2;
      for (let i = 1; i <= 3; i++) {
        const t = i / 3.2;
        const c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("cx", ((bcx + (d.anchor.col - bcx) * t) * 100).toFixed(1));
        c.setAttribute("cy", ((bcy + (d.anchor.row - bcy) * t) * 100).toFixed(1));
        c.setAttribute("r", ((16 - i * 3) * scale).toFixed(1));
        c.setAttribute("class", "tail-shape");
        svg.appendChild(c);
      }
    } else {
      const poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", buildTail(d.rect, d.anchor, tw));
      poly.setAttribute("class", "tail-shape");
      svg.appendChild(poly);
    }
  });
  container.appendChild(svg);
}

function renderBubbles(container, dialogue, caption, sfx) {
  container.innerHTML = "";

  const meaningful = (d) => d.text && String(d.text).trim() && String(d.text).trim() !== "0";
  const positioned = (dialogue || []).filter((d) => meaningful(d) && d.rect);
  const floating = (dialogue || []).filter((d) => meaningful(d) && !d.rect);

  // זנבות (שכבה אחת מתחת לבועות)
  renderTails(container, positioned);

  // בועות ממוקמות לפי מלבן הרשת
  positioned.forEach((d) => {
    const b = document.createElement("div");
    b.className = "comic-bubble positioned kind-" + (d.kind || "speech");
    b.dataset.dlgIndex = (dialogue || []).indexOf(d);
    b.style.left = (d.rect.col / GRID_COLS * 100) + "%";
    b.style.top = (d.rect.row / GRID_ROWS * 100) + "%";
    b.style.width = (d.rect.w / GRID_COLS * 100) + "%";
    b.style.height = (d.rect.h / GRID_ROWS * 100) + "%";
    if (d.font_size) b.style.fontSize = (1.0 * d.font_size).toFixed(3) + "em";
    b.innerHTML = bubbleInnerHtml(d);
    container.appendChild(b);
  });

  // קריינות למעלה + בועות ללא מיקום (תאימות לאחור) נערמות למטה
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
  floating.forEach((d) => {
    const b = document.createElement("div");
    b.className = "comic-bubble kind-" + (d.kind || "speech");
    if (d.font_size) b.style.fontSize = (1.24 * d.font_size).toFixed(3) + "em";
    b.innerHTML = bubbleInnerHtml(d);
    bottom.appendChild(b);
  });
  container.appendChild(top);
  container.appendChild(bottom);

  // אפקט קול
  if (sfx) {
    const fx = document.createElement("div");
    fx.className = "comic-sfx";
    fx.textContent = sfx;
    container.appendChild(fx);
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

// ---------- עריכה החלטית של בועות: לחיצה פותחת תפריט (הזזה/גודל/זנב) + ✓ לאישור ----------
let activeEdit = null; // { b, card, overlay, row, snapshot, mode, popup, bubbleHandler }

function enableBubbleEditing(card) {
  const overlay = card.querySelector(".panel-bubbles");
  if (!overlay) return;
  $$(".comic-bubble.positioned", overlay).forEach((b) => {
    b.classList.add("editable");
    b.addEventListener("click", (e) => {
      if (activeEdit && activeEdit.b === b) return; // כבר בעריכה
      e.stopPropagation();
      openBubbleEditor(b, overlay, card);
    });
  });
}

function snapshotRow(row) {
  return {
    rect: row.dataset.rect || "",
    anchor: row.dataset.anchor || "",
    tailPoints: row.dataset.tailPoints || "",
  };
}
function restoreRow(row, snap) {
  ["rect", "anchor", "tailPoints"].forEach((k) => {
    if (snap[k]) row.dataset[k] = snap[k]; else delete row.dataset[k];
  });
}

function openBubbleEditor(b, overlay, card) {
  if (activeEdit) closeBubbleEditor("save");
  const row = rowForBubble(card, b);
  if (!row) return;
  b.classList.add("editing");
  const popup = document.createElement("div");
  popup.className = "bubble-edit-menu";
  popup.setAttribute("data-html2canvas-ignore", "true");
  popup.innerHTML =
    '<button data-mode="move" title="הזזה">✥</button>' +
    '<button data-mode="size" title="שינוי גודל">⤢</button>' +
    '<button data-mode="tail" title="עריכת זנב (קודקודים)">🪝</button>' +
    '<button data-act="ok" class="ok" title="אישור">✓</button>' +
    '<button data-act="cancel" class="cancel" title="ביטול">✕</button>';
  popup.style.left = b.style.left;
  popup.style.top = b.style.top;
  overlay.appendChild(popup);
  activeEdit = { b, card, overlay, row, snapshot: snapshotRow(row), mode: null, popup, bubbleHandler: null };
  popup.querySelectorAll("button[data-mode]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); setEditMode(btn.dataset.mode, btn); });
  });
  popup.querySelector('[data-act="ok"]').addEventListener("click", (e) => { e.stopPropagation(); closeBubbleEditor("save"); });
  popup.querySelector('[data-act="cancel"]').addEventListener("click", (e) => { e.stopPropagation(); closeBubbleEditor("revert"); });
}

function clearEditMode() {
  if (!activeEdit) return;
  const { b, overlay } = activeEdit;
  if (activeEdit.bubbleHandler) {
    b.removeEventListener("pointerdown", activeEdit.bubbleHandler);
    activeEdit.bubbleHandler = null;
  }
  b.classList.remove("mode-move", "mode-size");
  overlay.querySelectorAll(".tail-vertex").forEach((v) => v.remove());
}

function setEditMode(mode, btn) {
  if (!activeEdit) return;
  clearEditMode();
  activeEdit.mode = mode;
  activeEdit.popup.querySelectorAll("button[data-mode]").forEach((x) => x.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const { b } = activeEdit;
  if (mode === "move" || mode === "size") {
    activeEdit.bubbleHandler = (e) => startBubbleDrag(e, mode);
    b.addEventListener("pointerdown", activeEdit.bubbleHandler);
    b.classList.add("mode-" + mode);
  } else if (mode === "tail") {
    showTailVertices();
  }
}

function closeBubbleEditor(action) {
  if (!activeEdit) return;
  const { b, card, row, snapshot, popup } = activeEdit;
  clearEditMode();
  if (popup) popup.remove();
  b.classList.remove("editing");
  activeEdit = null;
  if (action === "revert") {
    restoreRow(row, snapshot);
    applyRectToBubble(b, row);
    refreshTails(card);
  } else if (action === "save") {
    persistDialogue(card);
  }
}

function bubbleGrid(b) {
  return {
    col: parseFloat(b.style.left) / 100 * GRID_COLS,
    row: parseFloat(b.style.top) / 100 * GRID_ROWS,
    w: parseFloat(b.style.width) / 100 * GRID_COLS,
    h: parseFloat(b.style.height) / 100 * GRID_ROWS,
  };
}
function applyRectToBubble(b, row) {
  if (!row.dataset.rect) return;
  try {
    const r = JSON.parse(row.dataset.rect);
    b.style.left = (r.col / GRID_COLS * 100) + "%";
    b.style.top = (r.row / GRID_ROWS * 100) + "%";
    b.style.width = (r.w / GRID_COLS * 100) + "%";
    b.style.height = (r.h / GRID_ROWS * 100) + "%";
  } catch (e) {}
}

// הזזה/שינוי-גודל של הבועה — פעיל רק לאחר בחירת מצב בתפריט
function startBubbleDrag(e, mode) {
  if (!activeEdit) return;
  e.preventDefault();
  e.stopPropagation();
  const { b, overlay, card, row, popup } = activeEdit;
  const cl = (v, a, c) => Math.max(a, Math.min(c, v));
  const box = overlay.getBoundingClientRect();
  const start = bubbleGrid(b);
  const sx = e.clientX, sy = e.clientY;
  const onMove = (ev) => {
    const dCol = (ev.clientX - sx) / box.width * GRID_COLS;
    const dRow = (ev.clientY - sy) / box.height * GRID_ROWS;
    const r = Object.assign({}, start);
    if (mode === "move") {
      r.col = cl(start.col + dCol, 0, GRID_COLS - start.w);
      r.row = cl(start.row + dRow, 0, GRID_ROWS - start.h);
    } else {
      r.w = cl(start.w + dCol, 1, GRID_COLS - start.col);
      r.h = cl(start.h + dRow, 1, GRID_ROWS - start.row);
    }
    b.style.left = (r.col / GRID_COLS * 100) + "%";
    b.style.top = (r.row / GRID_ROWS * 100) + "%";
    b.style.width = (r.w / GRID_COLS * 100) + "%";
    b.style.height = (r.h / GRID_ROWS * 100) + "%";
    row.dataset.rect = JSON.stringify({
      col: Math.round(r.col), row: Math.round(r.row),
      w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)),
    });
    if (popup) { popup.style.left = b.style.left; popup.style.top = b.style.top; }
    refreshTails(card);
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// קודקודי הזנב — כל קודקוד נגרר בנפרד ואינו משפיע על האחרים
function showTailVertices() {
  if (!activeEdit) return;
  const { overlay, card, row } = activeEdit;
  let pts = null;
  if (row.dataset.tailPoints) { try { pts = JSON.parse(row.dataset.tailPoints); } catch (e) {} }
  if (!pts || pts.length !== 3) {
    let rect;
    try { rect = JSON.parse(row.dataset.rect); } catch (e) { return; }
    let anchor = null;
    if (row.dataset.anchor) { try { anchor = JSON.parse(row.dataset.anchor); } catch (e) {} }
    anchor = anchor || { col: rect.col + rect.w / 2, row: rect.row + rect.h + 0.6 };
    pts = tailTriangle(rect, anchor, 0.45);
    row.dataset.tailPoints = JSON.stringify(pts);
    refreshTails(card);
  }
  pts.forEach((p, i) => {
    const dot = document.createElement("div");
    dot.className = "tail-vertex";
    dot.setAttribute("data-html2canvas-ignore", "true");
    dot.style.left = (p.col / GRID_COLS * 100) + "%";
    dot.style.top = (p.row / GRID_ROWS * 100) + "%";
    overlay.appendChild(dot);
    bindVertexDrag(dot, i);
  });
}

function bindVertexDrag(dot, idx) {
  const cl = (v, a, c) => Math.max(a, Math.min(c, v));
  const onMove = (e) => {
    if (!activeEdit) return;
    const { overlay, card, row } = activeEdit;
    const box = overlay.getBoundingClientRect();
    const col = cl((e.clientX - box.left) / box.width * GRID_COLS, 0, GRID_COLS);
    const rw = cl((e.clientY - box.top) / box.height * GRID_ROWS, 0, GRID_ROWS);
    dot.style.left = (col / GRID_COLS * 100) + "%";
    dot.style.top = (rw / GRID_ROWS * 100) + "%";
    let pts;
    try { pts = JSON.parse(row.dataset.tailPoints); } catch (e) { return; }
    pts[idx] = { col: +col.toFixed(2), row: +rw.toFixed(2) };
    row.dataset.tailPoints = JSON.stringify(pts);
    refreshTails(card);
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  };
  dot.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function rowForBubble(card, b) {
  const idx = parseInt(b.dataset.dlgIndex, 10);
  return $$(".dialogue-row", card)[idx] || null;
}

// מעדכן גודל גופן של הבועות החיות לפי הבקרות בשורות (תצוגה מיידית)
function applyFontLive(card) {
  const rows = $$(".dialogue-row", card);
  $$(".comic-bubble.positioned", card).forEach((b) => {
    const row = rows[parseInt(b.dataset.dlgIndex, 10)];
    const inp = row && row.querySelector(".dlg-font-input");
    if (inp) b.style.fontSize = (1.0 * parseFloat(inp.value)).toFixed(3) + "em";
  });
}

// מרענן את שכבת זנבות הבועות לפי המצב הנוכחי של השורות
function refreshTails(card) {
  const overlay = card.querySelector(".panel-bubbles");
  if (!overlay) return;
  const old = overlay.querySelector(".bubble-tails");
  if (old) old.remove();
  const positioned = collectDialogue(card).filter((d) => d.text && d.rect);
  renderTails(overlay, positioned);
  const svg = overlay.querySelector(".bubble-tails");
  if (svg) overlay.prepend(svg); // מתחת לבועות
}

// שומר את הדיאלוג (כולל rect/anchor/font_size) בלי רינדור-מחדש מלא
async function persistDialogue(card) {
  const sceneId = card.dataset.sceneId;
  if (!sceneId) return;
  const dialogue = collectDialogue(card);
  const panel = getPanels().find((p) => p.scene_id === sceneId);
  if (panel) panel.dialogue = dialogue;
  renderPreviewSidebar();
  try {
    await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}${wsParam()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dialogue }),
    });
    setStatus("בועות עודכנו ✓", "ok");
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  }
}

// ---------- פעולות פאנל ----------
function panelPayload(card) {
  return {
    description: card.querySelector(".panel-desc").value,
    location: card.querySelector(".location-text").value,
    prompt: card.querySelector(".prompt-text").value,
    caption: card.querySelector(".caption-text").value,
    sfx: card.querySelector(".sfx-text").value,
    size: card.querySelector(".panel-size").value,
    shape: card.querySelector(".panel-shape").value,
    dialogue: collectDialogue(card),
  };
}

async function savePanel(sceneId, card) {
  setStatus("שומר פאנל...");
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}${wsParam()}`, {
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
  const clip = card.querySelector(".panel-clip");
  clip.className = clip.className.replace(/shape-\S+/g, "").trim() + " shape-" + shape;
  renderPreviewSidebar();
  try {
    await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}${wsParam()}`, {
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
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}${wsParam()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(panelPayload(card)),
  });
  setStatus("יוצר תמונה לפאנל...");
  try {
    await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}/generate${wsParam()}`, {
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
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}/approve${wsParam()}`, { method: "POST" });
  await loadComic(currentComic);
  setStatus("אושר ✓", "ok");
}

async function deletePanel(sceneId) {
  if (!confirm("למחוק את הפאנל?")) return;
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${sceneId}${wsParam()}`, { method: "DELETE" });
  await loadComic(currentComic);
  setStatus("נמחק", "ok");
}

// ---------- הצעת פאנלים (Claude) ----------
async function proposePanels(customPrompt) {
  setStatus("Claude מפרק לפאנלים... (עשוי לקחת זמן)");
  try {
    project = await api(`/api/comics/${encodeURIComponent(currentComic)}/propose${wsParam()}`, {
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
  // שלב 1: ייצר רפרנסים חדשים שטרם נוצרו
  const newRefs = getNewRefs();
  for (const ref of newRefs) {
    const existing = references.find((r) => r.name === ref.name);
    if (existing) { removeNewRef(ref.id); continue; }
    setStatus(`מייצר רפרנס: ${ref.name}...`);
    try {
      const res = await api(`/api/project/${encodeURIComponent(currentComic)}/create-reference-image${wsParam()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ref.name,
          description: ref.description,
          category: ref.category || "characters",
          age: ref.age,
          height: ref.height,
        }),
      });
      references.push(res);
      removeNewRef(ref.id);
      setStatus(`רפרנס "${res.name}" נוצר ✓`, "ok");
    } catch (e) {
      setStatus(`שגיאה ביצירת רפרנס "${ref.name}": ${e.message}`, "err");
    }
  }

  // שלב 2: ייצר תמונות לפאנלים
  const panels = getPanels();
  for (const p of panels) {
    if (p.image_path) continue;
    setStatus(`יוצר תמונה לפאנל ${p.panel_number}...`);
    try {
      await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${p.scene_id}/generate${wsParam()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // הצג את התמונה מיד אחרי שנוצרה
      const card = document.querySelector(`[data-scene-id="${p.scene_id}"]`);
      if (card) {
        const preview = card.querySelector(".panel-image-preview");
        const img = card.querySelector(".panel-image-preview img") || document.createElement("img");
        img.src = `/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${p.scene_id}/image?t=${Date.now()}${wsAmp()}`;
        if (!preview.contains(img)) preview.prepend(img);
        preview.classList.add("has-image");
      }
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
      <img src="/api/reference-image/${encodeURIComponent(r.id)}${wsParam()}" alt="" />
      <span>${r.name || r.id}</span>`;
    div.dataset.value = value;
    div.addEventListener("click", () => div.classList.toggle("selected"));
    grid.appendChild(div);
  });
  $("#refModal").classList.remove("hidden");
}

async function saveRefModal() {
  const selected = $$(".ref-grid-item.selected", $("#refGrid")).map((d) => d.dataset.value);
  await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${refModalSceneId}${wsParam()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ references: selected }),
  });
  $("#refModal").classList.add("hidden");
  await loadComic(currentComic);
}

// ---------- אירועים גלובליים ----------
function bindEvents() {
  // Workspace events
  const workspaceSelect = $("#workspaceSelect");
  if (workspaceSelect) {
    workspaceSelect.addEventListener("change", async () => {
      const list = await api("/api/workspaces");
      const chosen = list.find(w => w.id === workspaceSelect.value);
      if (!chosen) return;
      currentWorkspace = chosen;
      localStorage.setItem("lastWorkspaceId", chosen.id);
      currentComic = null;
      project = null;
      await loadReferences();
      await loadComicsList();
      if (currentComic) await loadComic(currentComic);
    });
  }
  const newWsBtn = $("#newWorkspaceBtn");
  if (newWsBtn) newWsBtn.addEventListener("click", () => $("#newWorkspaceModal").classList.remove("hidden"));
  const wsCancel = $("#wsCancel");
  if (wsCancel) wsCancel.addEventListener("click", () => $("#newWorkspaceModal").classList.add("hidden"));
  const wsSave = $("#wsSave");
  if (wsSave) wsSave.addEventListener("click", async () => {
    const name = $("#wsName").value.trim();
    if (!name) return alert("יש להזין שם למרחב העבודה");
    const desc = $("#wsDesc").value.trim();
    try {
      const newWs = await api("/api/workspaces", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name, description: desc }) });
      currentWorkspace = { id: newWs.id, name: newWs.name };
      localStorage.setItem("lastWorkspaceId", newWs.id);
      await loadWorkspacesList();
      $("#workspaceSelect").value = newWs.id;
      currentComic = null; project = null; references = [];
      renderGlobalRefs();
      await loadComicsList();
      renderPanels();
      $("#newWorkspaceModal").classList.add("hidden");
      $("#wsName").value = ""; $("#wsDesc").value = "";
      setStatus(`מרחב "${name}" נוצר ✓`, "ok");
    } catch(e) { setStatus("שגיאה: " + e.message, "err"); }
  });

  $("#comicSelect").addEventListener("change", (e) => loadComic(e.target.value));

  // קומיקס חדש
  $("#newComicBtn").addEventListener("click", () => $("#newComicModal").classList.remove("hidden"));
  $("#ncCancel").addEventListener("click", () => $("#newComicModal").classList.add("hidden"));
  $("#ncSave").addEventListener("click", async () => {
    const body = {
      comic_id: $("#ncId").value.trim(),
      title: $("#ncTitle").value.trim(),
      description: $("#ncDesc").value.trim(),
      pages_target: parseInt($("#ncPages").value) || 1,
    };
    if (!body.comic_id || !body.description) { alert("נא למלא מזהה ותיאור"); return; }
    try {
      const proj = await api(`/api/comics/create${wsParam()}`, {
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
    $("#ecPages").value = project.pages_target || 1;
    $("#editComicModal").classList.remove("hidden");
  });
  $("#ecCancel").addEventListener("click", () => $("#editComicModal").classList.add("hidden"));
  $("#ecSave").addEventListener("click", async () => {
    project = await api(`/api/comics/${encodeURIComponent(currentComic)}${wsParam()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: $("#ecDesc").value,
        director_instructions: $("#ecDirector").value,
        style_description: $("#ecStyle").value,
        pages_target: parseInt($("#ecPages").value) || 1,
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
    const data = await api(`/api/comics/${encodeURIComponent(currentComic)}/prompt-preview${wsParam()}`);
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

  // שיפור עמוד ב-Gemini — פרומפט ברירת מחדל + החלפה לפי הבורר
  const rp = $("#refinePrompt"), wt = $("#refineWithText");
  if (rp) {
    rp.value = REFINE_PROMPTS.notext;
    rp.addEventListener("input", () => { refinePromptDirty = true; });
  }
  if (wt) {
    wt.addEventListener("change", () => {
      if (rp && !refinePromptDirty) rp.value = wt.checked ? REFINE_PROMPTS.withtext : REFINE_PROMPTS.notext;
    });
  }

  // סרגל תצוגה מקדימה
  $("#togglePreviewBtn").addEventListener("click", () => togglePreview(false));
  $("#showPreviewBtn").addEventListener("click", () => togglePreview(true));
}

// ---------- עיצוב עמוד (פריסה + ייצוא) ----------
const PAGE_COLS = 6;
const PAGE_ROWS = 4;

const SIZE_DIMS = {
  // אוצר מילים חדש (רשת 6×4)
  third: { w: 2, h: 1 },
  half: { w: 3, h: 1 },
  two_thirds: { w: 4, h: 1 },
  full: { w: 6, h: 1 },
  tall: { w: 2, h: 2 },
  big: { w: 3, h: 2 },
  splash: { w: 6, h: 4 },
  // aliases לתאימות לאחור
  regular: { w: 3, h: 1 },
  wide: { w: 6, h: 1 },
};
const DEFAULT_DIM = SIZE_DIMS.half;

// יחס-ממדים של פאנל לפי size, וגופן בועות יחסי לרוחב הפאנל (cqw) — זהה בעורך ובעמוד.
// 600/52 = 11.538: משחזר את בסיס הגופן של העמוד (page-w/52) יחסית לרוחב הפאנל.
function panelDims(size) { return SIZE_DIMS[size] || DEFAULT_DIM; }
function bubbleFontFor(size) { return (11.538 / panelDims(size).w).toFixed(3) + "cqw"; }

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
  let curPage = null; // מספר העמוד (page) של הפאנל הקודם — לכיבוד חלוקת Claude
  panels.forEach((panel) => {
    const { w, h } = SIZE_DIMS[panel.size] || DEFAULT_DIM;
    // אם Claude שייך את הפאנל לעמוד חדש — מתחילים עמוד פיזי חדש
    if (panel.page != null) {
      if (curPage != null && panel.page !== curPage && placements.length) newPage();
      curPage = panel.page;
    }
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
  pages.forEach((placements, pageIdx) => {
    const page = document.createElement("div");
    page.className = "comic-page";
    placements.forEach(({ panel, row, col, w, h }) => {
      const cell = document.createElement("div");
      cell.className = "page-panel size-" + (panel.size || "half");
      cell.style.gridColumn = `${col + 1} / span ${w}`;
      cell.style.gridRow = `${row + 1} / span ${h}`;

      const clip = document.createElement("div");
      clip.className = "panel-clip shape-" + (panel.shape || "rect");
      if (panel.image_path) {
        const img = document.createElement("img");
        img.crossOrigin = "anonymous";
        img.src = `/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/scene/${panel.scene_id}/image?t=${Date.now()}${wsAmp()}`;
        clip.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "no-image-placeholder";
        ph.innerHTML = "<span>🖼️</span>";
        clip.appendChild(ph);
      }
      cell.appendChild(clip);

      const bubbles = document.createElement("div");
      bubbles.className = "panel-bubbles";
      bubbles.style.fontSize = bubbleFontFor(panel.size);
      renderBubbles(bubbles, panel.dialogue || [], panel.caption || "", panel.sfx || "");
      cell.appendChild(bubbles);

      page.appendChild(cell);
    });
    if (pages.length > 1) {
      const num = document.createElement("div");
      num.className = "comic-page-number";
      num.textContent = pageIdx + 1;
      page.appendChild(num);
    }
    const refineBtn = document.createElement("button");
    refineBtn.className = "page-refine-btn";
    refineBtn.textContent = "✨ שפר ב-Gemini";
    refineBtn.setAttribute("data-html2canvas-ignore", "true");
    refineBtn.addEventListener("click", () => refinePage(page, refineBtn, pageIdx));
    page.appendChild(refineBtn);
    if (refinedPages[pageIdx]) showRefined(page, pageIdx); // שחזור עמוד משופר שנשמר
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

// ---------- שיפור עמוד ב-Gemini ----------
const GEOM_RULE = " חשוב ביותר: החזר תמונה בדיוק באותם ממדים ויחס-גובה-רוחב של התמונה שקיבלת, " +
  "באותו מסגור מדויק — אל תחתוך, אל תקרב/תרחיק (zoom), אל תוסיף שוליים, מסגרת או ריפוד, " +
  "ואל תזיז את גבולות הפאנלים. כל פיקסל צריך להישאר במקומו פרט לשיפורים שביקשתי.";
const REFINE_PROMPTS = {
  notext: "זהו עמוד קומיקס. שלב את בועות הדיבור והזנבות בצורה טבעית וחלקה בתוך הסצנה, " +
    "ותקן פגמים קטנים באיור (אצבעות מיותרות, עיוותים, חיתוכים, ברים שחורים). " +
    "הבועות ריקות בכוונה — שמור בדיוק על מיקומן, גודלן וצורתן ואל תוסיף שום טקסט. " +
    "שמור על הפריסה, הצבעים והדמויות זהים לחלוטין." + GEOM_RULE,
  withtext: "זהו עמוד קומיקס. שלב את בועות הדיבור והזנבות בצורה טבעית וחלקה בתוך הסצנה, " +
    "ותקן פגמים קטנים באיור. שמור בדיוק על הטקסט בעברית כפי שהוא — אל תשנה, תזיז, " +
    "תתרגם או תעוות אף אות. שמור על הפריסה, הצבעים והדמויות זהים לחלוטין." + GEOM_RULE,
};
let refinePromptDirty = false;

async function refinePage(pageEl, btn, pageIdx) {
  const withText = !!($("#refineWithText") && $("#refineWithText").checked);
  const prompt = ($("#refinePrompt") && $("#refinePrompt").value.trim()) || REFINE_PROMPTS.notext;
  if (btn) btn.disabled = true;
  setExport("מכין עמוד לשליחה...");
  let dataUrl;
  if (!withText) pageEl.classList.add("hide-bubble-text");
  try {
    const canvas = await renderPageCanvas(pageEl);
    dataUrl = canvas.toDataURL("image/png");
  } catch (e) {
    pageEl.classList.remove("hide-bubble-text");
    if (btn) btn.disabled = false;
    setExport("שגיאת לכידה: " + e.message);
    return;
  }
  pageEl.classList.remove("hide-bubble-text");
  setExport("שולח ל-Gemini לשיפור... (עשוי לקחת רגע)");
  try {
    const res = await api(`/api/project/${encodeURIComponent(currentComic)}/minute/${COMIC_SLOT_ID}/page/refine${wsParam()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, prompt, page_index: pageIdx, with_text: withText }),
    });
    // שמירה (כדי שישרוד מעבר בין תצוגות + רענון) + הצגה
    refinedPages[pageIdx] = { image: res.image, withText };
    showRefined(pageEl, pageIdx);
    setExport("העמוד שופר ✓");
  } catch (e) {
    setExport("שגיאה: " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// מציג את תמונת Gemini השמורה כרקע העמוד; במצב 'ללא טקסט' הטקסט שלנו נשאר מעל (שקוף)
function showRefined(pageEl, pageIdx) {
  const stored = refinedPages[pageIdx];
  if (!stored) return;
  pageEl.querySelectorAll(".refined-bg").forEach((e) => e.remove());
  const img = document.createElement("img");
  img.className = "refined-bg";
  img.src = stored.image;
  pageEl.prepend(img);
  pageEl.classList.add("refined");
  pageEl.classList.toggle("refined-notext", stored.withText); // עם טקסט בתמונה → להסתיר בועות
  pageEl.classList.toggle("refined-text", !stored.withText);  // בלי טקסט → להלביש טקסט מעל
  ensureRefineToggle(pageEl, pageIdx);
}

function hideRefined(pageEl, pageIdx) {
  pageEl.querySelectorAll(".refined-bg").forEach((e) => e.remove());
  pageEl.classList.remove("refined", "refined-text", "refined-notext");
  ensureRefineToggle(pageEl, pageIdx);
}

// כפתור החלפה: מקור ⇄ משופר (העמוד המשופר נשמר ב-refinedPages ולא נמחק)
function ensureRefineToggle(pageEl, pageIdx) {
  let btn = pageEl.querySelector(".refined-toggle-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.className = "refined-toggle-btn small-btn";
    btn.setAttribute("data-html2canvas-ignore", "true");
    btn.addEventListener("click", () => {
      if (pageEl.classList.contains("refined")) hideRefined(pageEl, pageIdx);
      else showRefined(pageEl, pageIdx);
    });
    pageEl.appendChild(btn);
  }
  btn.textContent = pageEl.classList.contains("refined") ? "🖼 הצג מקור" : "✨ הצג משופר";
}

async function init() {
  await loadWorkspacesList();
  bindEvents();
  await loadReferences();
  await loadComicsList();
  await loadComic($("#comicSelect").value);
}

init();
