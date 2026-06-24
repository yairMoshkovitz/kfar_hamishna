"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentMishna = null;
let project = null;
let references = [];
let refModalMinuteId = null;
let refModalSceneId = null;

let editModalMinuteId = null;
let editModalSceneId = null;
let isLoopPlaying = false;
let loopTimer = null;
let wavesurfer = null;
let wsRegion = null;
let allCues = [];

function parseSrtToObjects(srtText) {
    if (!srtText) return [];
    const cues = [];
    const blocks = srtText.replace(/\r\n/g, '\n').split('\n\n');
    for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        if (lines.length >= 3) {
            const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
            if (timeMatch) {
                const parseTime = (t) => {
                    const parts = t.replace(',', '.').split(':');
                    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
                };
                cues.push({
                    start: parseTime(timeMatch[1]),
                    end: parseTime(timeMatch[2]),
                    text: lines.slice(2).join(' ')
                });
            }
        }
    }
    return cues;
}

async function fetchCues() {
    if (allCues.length > 0) return;
    try {
        const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/srt-content`);
        if (res.ok) {
            const data = await res.json();
            // data.content contains the raw SRT string
            allCues = parseSrtToObjects(data.content || "");
        }
    } catch (e) {
        console.warn("Could not load SRT cues", e);
    }
}

function updateSrtOverlay(currentTime) {
    if (!Array.isArray(allCues) || allCues.length === 0) return;
    const currentCue = allCues.find(c => currentTime >= c.start && currentTime <= c.end);
    const overlay = $("#srtOverlay");
    if (currentCue) {
        overlay.textContent = currentCue.text;
    } else {
        overlay.textContent = "...";
    }
}

async function initWavesurfer(startStr, endStr) {
    // WaveSurfer 7.x — plugins are loaded as separate globals from their own <script> tags:
    // WaveSurfer.Regions  → from wavesurfer.js@7/dist/plugins/regions.min.js
    // WaveSurfer.Timeline → from wavesurfer.js@7/dist/plugins/timeline.min.js

    let wsRegionsPlugin = null;

    if (!wavesurfer) {
        wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#d8d2c4',
            progressColor: '#3f6ec2',
            cursorColor: '#c2683f',
            height: 100,
            normalize: true,
            minPxPerSec: 50,
            autoScroll: true,
            autoCenter: true
        });

        // In WaveSurfer 7, plugins are registered with registerPlugin after creation
        const timelinePlugin = WaveSurfer.Timeline.create({
            container: '#waveform-timeline',
            height: 20,
            timeInterval: 1, // שנתה כל שנייה (כדי לראות רזולוציה טובה)
            primaryLabelInterval: 60, // תווית של זמן (מספר) תופיע רק כל דקה
            secondaryLabelInterval: 10, // שנתה מודגשת כל 10 שניות (אופציונלי)
            formatTimeCallback: (seconds) => {
                const m = Math.floor(seconds / 60);
                const s = seconds % 60;
                return `${m}:${s.toString().padStart(2, '0')}`;
            },
            style: { fontSize: '10px', color: 'var(--muted)' }
        });
        wavesurfer.registerPlugin(timelinePlugin);

        wsRegionsPlugin = WaveSurfer.Regions.create();
        wavesurfer.registerPlugin(wsRegionsPlugin);

        // Update SRT overlay as audio plays
        wavesurfer.on('timeupdate', (currentTime) => {
            updateSrtOverlay(currentTime);
            const timeDisplay = $("#currentTimeDisplay");
            if (timeDisplay) timeDisplay.textContent = secondsToTimestamp(currentTime);
        });

        // Wire up region drag/resize → update time inputs + SRT overlay live
        wsRegionsPlugin.on('region-updated', (region) => {
            const startTs = secondsToTimestamp(region.start);
            const endTs = secondsToTimestamp(region.end);
            $("#editSceneStart").value = startTs;
            $("#editSceneEnd").value = endTs;
            $("#editSceneTimeLabel").textContent = `${startTs} → ${endTs}`;
            
            // Show the subtitle at the *start* of the region while user drags
            updateSrtOverlay(region.start);
        });

        // Also update SRT while resizing the end handle
        wsRegionsPlugin.on('region-update', (region) => {
            const startTs = secondsToTimestamp(region.start);
            const endTs = secondsToTimestamp(region.end);
            $("#editSceneStart").value = startTs;
            $("#editSceneEnd").value = endTs;
            $("#editSceneTimeLabel").textContent = `${startTs} → ${endTs}`;
            updateSrtOverlay(region.start);
        });

        // Store the plugin reference for later calls
        wavesurfer._regionsPlugin = wsRegionsPlugin;

        // stop playback button
        const stopBtn = $("#stopWaveformBtn");
        if (stopBtn) {
            stopBtn.onclick = () => {
                wavesurfer.stop();
            };
        }
    } else {
        // Retrieve the already-created regions plugin
        wsRegionsPlugin = wavesurfer._regionsPlugin;
    }

    const audioUrl = `/api/project/${encodeURIComponent(currentMishna)}/audio?t=${Date.now()}`;

    if (wavesurfer.getMediaElement()?.src !== new URL(audioUrl, window.location.href).href) {
        setStatus("טוען מנתח סאונד...");
        await wavesurfer.load(audioUrl);
        setStatus("מוכן", "ok");
    }

    await fetchCues();

    const startSec = timestampToSeconds(startStr);
    const endSec   = timestampToSeconds(endStr);

    // Clear previous region and add a fresh one
    if (wsRegionsPlugin) {
        wsRegionsPlugin.clearRegions();
        wsRegion = wsRegionsPlugin.addRegion({
            start: startSec,
            end:   endSec,
            color: 'rgba(255, 140, 0, 0.4)', // Orange overlay
            drag:   true,
            resize: true
        });
    }

    // Scroll to show the region - use setScrollTime with a small offset before it
    wavesurfer.setTime(startSec);
    setTimeout(() => {
        wavesurfer.setScrollTime(Math.max(0, startSec - 2));
    }, 150);

    // Show the subtitle at the scene start immediately
    updateSrtOverlay(startSec);

    // Allow manual editing of time inputs to move the region
    $("#editSceneStart").onchange = (e) => {
        const sec = timestampToSeconds(e.target.value);
        if (wsRegion) wsRegion.setOptions({ start: sec });
        updateSrtOverlay(sec);
    };
    $("#editSceneEnd").onchange = (e) => {
        const sec = timestampToSeconds(e.target.value);
        if (wsRegion) wsRegion.setOptions({ end: sec });
        updateSrtOverlay(sec);
    };
}

const playPauseBtn = $("#playPauseWaveformBtn");

if (playPauseBtn) {
    playPauseBtn.onclick = () => {
        if (!wavesurfer) return;
        if (wavesurfer.isPlaying()) {
            wavesurfer.pause();
        } else {
            if (wsRegion && wavesurfer.getCurrentTime() >= wsRegion.end) {
                 wavesurfer.setTime(wsRegion.start);
            } else if (wsRegion && wavesurfer.getCurrentTime() < wsRegion.start) {
                 wavesurfer.setTime(wsRegion.start);
            }
            wavesurfer.play();
        }
    };
}

// Update play/pause button state
setInterval(() => {
    if (!wavesurfer || !playPauseBtn) return;
    if (wavesurfer.isPlaying()) {
        playPauseBtn.textContent = "⏸️";
        playPauseBtn.title = "השהה";
    } else {
        playPauseBtn.textContent = "▶️";
        playPauseBtn.title = "נגן";
    }
}, 100);

const playbackRateSelect = $("#playbackRateSelect");
if (playbackRateSelect) {
    playbackRateSelect.onchange = (e) => {
        if (wavesurfer) {
            wavesurfer.setPlaybackRate(parseFloat(e.target.value));
        }
    };
}

$("#zoomInBtn").onclick = () => {
    if(wavesurfer) wavesurfer.zoom(wavesurfer.options.minPxPerSec * 1.5);
};

$("#zoomOutBtn").onclick = () => {
    if(wavesurfer) wavesurfer.zoom(wavesurfer.options.minPxPerSec / 1.5);
};

$("#closeEditSceneBtn").onclick = () => {
    $("#editSceneModal").classList.add("hidden");
    if (wavesurfer && wavesurfer.isPlaying()) {
        wavesurfer.pause();
    }
};

const STEPS = ["transcription", "content", "references", "images", "video"];
let currentStep = "transcription";
const STEP_LABELS = {
  transcription: "המשך: מלא משנה + Prompt ←",
  content: "המשך: אשר רפרנסים ←",
  references: "המשך: צור תמונות ←",
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

function inferStep() {
  const minuteSlots = (project && project.slots) || [];
  if (!minuteSlots.length) return "transcription";

  let allHavePrompts = true;
  let hasNewRefs = false;
  let allHaveImages = true;

  for (const minute of minuteSlots) {
    if (minute.new_references && minute.new_references.length > 0) {
      hasNewRefs = true;
    }
    for (const scene of minute.scenes || []) {
      if (!scene.prompt || !scene.prompt.trim()) allHavePrompts = false;
      if (!scene.image_path) allHaveImages = false;
    }
  }

  if (allHaveImages) return "video";
  if (hasNewRefs) {
    if (allHavePrompts) return "references";
    return "content";
  }
  if (allHavePrompts) return "images";
  return "content";
}

const audio = new Audio();

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
    item.onclick = () => { renderRefsTable(); $("#manageRefsModal").classList.remove("hidden"); };
    container.appendChild(item);
  });
}

function renderRefsTable() {
    const tbody = $("#refsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const renderRowFields = (r, isProposed = false) => {
        const idAttr = isProposed ? `data-temp-id="${r.id}"` : `data-id="${r.id}"`;
        let fieldsHtml = "";
        if (r.category === "characters") {
            fieldsHtml = `
                <td><input type="text" value="${r.age || ""}" class="ref-edit-age" style="width: 50px;" ${idAttr} placeholder="גיל"/></td>
                <td><input type="text" value="${r.height || ""}" class="ref-edit-height" style="width: 80px;" ${idAttr} placeholder="גובה"/></td>
            `;
        } else if (r.category === "style") {
            fieldsHtml = `
                <td><input type="text" value="${r.mood || ""}" class="ref-edit-mood" style="width: 80px;" ${idAttr} placeholder="אווירה"/></td>
                <td><input type="text" value="${r.time_of_day || ""}" class="ref-edit-time" style="width: 80px;" ${idAttr} placeholder="שעה"/></td>
            `;
        } else if (r.category === "items") {
            fieldsHtml = `
                <td><input type="text" value="${r.material || ""}" class="ref-edit-material" style="width: 80px;" ${idAttr} placeholder="חומר"/></td>
                <td><input type="text" value="${r.condition || ""}" class="ref-edit-condition" style="width: 80px;" ${idAttr} placeholder="מצב"/></td>
            `;
        } else { fieldsHtml = `<td></td><td></td>`; }

        const dormantHtml = isProposed ? '' : `
            <label style="font-size: 10px; display: block; margin-top: 5px;">
                <input type="checkbox" class="ref-edit-dormant" ${idAttr} ${r.dormant ? 'checked' : ''}/> רדום
            </label>
        `;

        return `
            <td>
                ${isProposed ? '<div class="no-image-placeholder">❓</div>' : `
                    <div class="ref-table-img-container">
                        <img src="/api/reference-image/${encodeURIComponent(r.id)}?t=${Date.now()}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; cursor: pointer;" class="ref-table-img" ${idAttr} title="החלף תמונה"/>
                        <button class="v2-ref-btn" ${idAttr} title="ייצר V2" style="font-size: 10px; padding: 2px 4px; margin-top: 2px;">V2</button>
                    </div>
                `}
            </td>
            <td>
                <input type="text" value="${r.name || ""}" class="ref-edit-name" ${idAttr}/>
                ${dormantHtml}
            </td>
            <td><textarea class="ref-edit-desc" ${idAttr}>${r.description || ""}</textarea></td>
            ${fieldsHtml}
            <td>
                <select class="ref-edit-cat" ${idAttr}>
                    <option value="characters" ${r.category === "characters" ? "selected" : ""}>דמויות</option>
                    <option value="style" ${r.category === "style" ? "selected" : ""}>סגנון</option>
                    <option value="items" ${r.category === "items" ? "selected" : ""}>חפצים</option>
                </select>
            </td>
            <td>
                <button class="${isProposed ? 'create-ref-btn' : 'save-ref-row-btn'}" ${idAttr}>${isProposed ? '🎨' : '💾'}</button>
            </td>
        `;
    };

    references.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = renderRowFields(r, false);
        tbody.appendChild(tr);
    });

    if (project && project.slots) {
        project.slots.forEach(slot => {
            (slot.new_references || []).forEach(nr => {
                const tr = document.createElement("tr");
                tr.className = "proposed-ref-row";
                tr.innerHTML = renderRowFields(nr, true);
                tbody.appendChild(tr);
            });
        });
    }

    $$(".save-ref-row-btn").forEach(btn => {
        btn.onclick = async () => {
            const tr = btn.closest("tr");
            const id = btn.dataset.id;
            const body = {
                name: $(".ref-edit-name", tr).value,
                description: $(".ref-edit-desc", tr).value,
                age: $(".ref-edit-age", tr)?.value,
                height: $(".ref-edit-height", tr)?.value,
                mood: $(".ref-edit-mood", tr)?.value,
                time_of_day: $(".ref-edit-time", tr)?.value,
                material: $(".ref-edit-material", tr)?.value,
                condition: $(".ref-edit-condition", tr)?.value,
                category: $(".ref-edit-cat", tr).value,
                dormant: $(".ref-edit-dormant", tr)?.checked
            };
            try {
                await api(`/api/references/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
                const ref = references.find(x => x.id === id);
                if (ref) Object.assign(ref, body);
                setStatus("רפרנס עודכן ✓", "ok");
                renderGlobalRefs();
            } catch (e) { setStatus("שגיאה: " + e.message, "err"); }
        };
    });

    $$(".ref-table-img").forEach(img => {
        img.onclick = () => {
            const id = img.dataset.id;
            const input = $("#hiddenRefImageInput");
            input.onchange = async () => {
                if (!input.files.length) return;
                const fd = new FormData();
                fd.append("file", input.files[0]);
                setStatus(`מעלה תמונה חדשה לרפרנס ${id}...`);
                try {
                    const res = await fetch(`/api/references/${encodeURIComponent(id)}/image`, { method: "POST", body: fd });
                    const updatedRef = await res.json();
                    const idx = references.findIndex(r => r.id === id);
                    if (idx >= 0) references[idx] = updatedRef;
                    renderRefsTable();
                    renderGlobalRefs();
                    setStatus("תמונה עודכנה ✓", "ok");
                } catch (e) { setStatus("שגיאה: " + e.message, "err"); }
            };
            input.click();
        };
    });

    $$(".v2-ref-btn").forEach(btn => {
        btn.onclick = async () => {
            const id = btn.dataset.id;
            setStatus(`מייצר גרסת V2 לרפרנס ${id}...`);
            btn.disabled = true;
            try {
                const res = await api(`/api/references/${encodeURIComponent(id)}/v2?mishna_id=${encodeURIComponent(currentMishna)}`, { method: "POST" });
                const idx = references.findIndex(r => r.id === id);
                if (idx >= 0) references[idx] = res;
                renderRefsTable();
                renderGlobalRefs();
                setStatus("גרסת V2 נוצרה בהצלחה ✓", "ok");
            } catch (e) { setStatus("שגיאה: " + e.message, "err"); btn.disabled = false; }
        };
    });

    $$(".create-ref-btn").forEach(btn => {
        btn.onclick = async () => {
            const tr = btn.closest("tr");
            const tempId = btn.dataset.tempId;
            const nr = {
                name: $(".ref-edit-name", tr).value,
                description: $(".ref-edit-desc", tr).value,
                age: $(".ref-edit-age", tr)?.value,
                height: $(".ref-edit-height", tr)?.value,
                mood: $(".ref-edit-mood", tr)?.value,
                time_of_day: $(".ref-edit-time", tr)?.value,
                material: $(".ref-edit-material", tr)?.value,
                condition: $(".ref-edit-condition", tr)?.value,
                category: $(".ref-edit-cat", tr).value
            };
            setStatus(`מייצר רפרנס ל-${nr.name}...`);
            btn.disabled = true;
            try {
                const res = await api(`/api/project/${encodeURIComponent(currentMishna)}/create-reference-image`, { method: "POST", body: JSON.stringify(nr) });
                references.push(res);
                project.slots.forEach(slot => { if (slot.new_references) slot.new_references = slot.new_references.filter(x => x.id !== tempId); });
                renderGlobalRefs();
                renderRefsTable();
                setStatus(`רפרנס ${nr.name} נוצר ✓`, "ok");
            } catch (e) { setStatus("שגיאה: " + e.message, "err"); btn.disabled = false; }
        };
    });

    $$(".ref-edit-cat").forEach(sel => {
        sel.onchange = () => {
            const id = sel.dataset.id || sel.dataset.tempId;
            const list = sel.dataset.tempId ? project.slots.flatMap(s => s.new_references || []) : references;
            const ref = list.find(x => x.id === id);
            if (ref) ref.category = sel.value;
            renderRefsTable();
        };
    });
}

async function init() {
  try {
    const refsData = await api("/api/references");
    references = (refsData && refsData.references) || [];
    renderGlobalRefs();
    await loadMishnayotList();
  } catch (e) { setStatus("שגיאת אתחול: " + e.message, "err"); }
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
  if (selectId) { sel.value = selectId; currentMishna = selectId; await loadProject(); }
  else if (list.length) { currentMishna = list[0].mishna_id; await loadProject(); }
}

async function loadProject() {
  const sel = $("#mishnaSelect");
  currentMishna = (sel && sel.value) || currentMishna;
  if (!currentMishna) return;
  setStatus("טוען...");
  try {
    project = await api(`/api/project/${encodeURIComponent(currentMishna)}`);
    if ($("#ipm")) $("#ipm").value = project.images_per_minute || 4;
    const audioContainer = $("#audioUploadContainer");
    if (!project.audio_path) {
      if (audioContainer) audioContainer.classList.add("missing-audio");
      if ($("#audioStatusLabel")) $("#audioStatusLabel").textContent = "חסר קובץ אודיו!";
      audio.src = "";
    } else {
      if (audioContainer) audioContainer.classList.remove("missing-audio");
      if ($("#audioStatusLabel")) $("#audioStatusLabel").textContent = "שמע קיים ✓";
      audio.src = `/api/project/${encodeURIComponent(currentMishna)}/audio?t=${Date.now()}`;
    }
    if ($("#directorInstructionsText")) $("#directorInstructionsText").value = project.director_instructions || "";
    if ($("#styleDescriptionText")) $("#styleDescriptionText").value = project.style_description || "";

    const srtContainer = $("#srtUploadContainer");
    if (!project.srt_path) {
      if (srtContainer) srtContainer.classList.add("missing-audio");
      if ($("#srtStatusLabel")) $("#srtStatusLabel").textContent = "חסר קובץ SRT!";
    } else {
      if (srtContainer) srtContainer.classList.remove("missing-audio");
      if ($("#srtStatusLabel")) $("#srtStatusLabel").textContent = "SRT קיים ✓";
    }

    renderTimeline();
    setStep(inferStep());
    const totalScenes = (project.slots || []).reduce((sum, m) => sum + (m.scenes || []).length, 0);
    setStatus(`${project.slots.length} דקות, ${totalScenes} סצנות`, "ok");
  } catch (e) { setStatus("שגיאה בטעינה: " + e.message, "err"); }
}

function renderTimeline() {
  const tel = $("#timeline");
  if (!tel) return;
  tel.innerHTML = "";

  if (!project || !project.slots || project.slots.length === 0) {
    tel.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--muted);">אין סצנות עדיין.</div>';
    return;
  }

  let allProposedRefs = [];
  project.slots.forEach(s => {
    if (s.new_references) allProposedRefs.push(...s.new_references);
  });

  if (allProposedRefs.length > 0) {
    const refSection = document.createElement("section");
    refSection.className = "minute-card proposed-refs-section";
    refSection.innerHTML = `
      <div class="minute-header">
        <h2 class="minute-title">דמויות ורפרנסים מוצעים לפרק זה</h2>
        <span class="minute-time-range">חובה לאשר לפני יצירת סצנות</span>
      </div>
      <div class="scenes-grid proposed-refs-grid"></div>
    `;
    const grid = $(".scenes-grid", refSection);
    allProposedRefs.forEach(ref => {
      grid.appendChild(renderProposedRef(ref));
    });
    tel.appendChild(refSection);
  }

  renderLocationsSummary(tel);

  const minuteTemplate = $("#minuteCardTemplate");
  project.slots.forEach((minuteSlot) => {
    const minuteNode = minuteTemplate.content.cloneNode(true);
    const minuteRoot = $(".minute-card", minuteNode);
    if ($(".minute-title", minuteRoot)) {
        $(".minute-title", minuteRoot).textContent = minuteSlot.id === "full-project-slot" ? `כל הסצנות` : `דקה ${minuteSlot.minute_index + 1}`;
    }
    if ($(".minute-time-range", minuteRoot)) $(".minute-time-range", minuteRoot).textContent = `${minuteSlot.start} → ${minuteSlot.end}`;
    const scenesGrid = $(".scenes-grid", minuteRoot);
    if (scenesGrid) {
      (minuteSlot.scenes || []).forEach((scene, idx) => {
        scenesGrid.appendChild(renderScene(minuteSlot.id, scene, idx + 1));
      });
    }
    tel.appendChild(minuteNode);
  });
}

function renderLocationsSummary(tel) {
  // אוסף את כל המקומות הייחודיים של הפרק עם מספר הסצנות בכל מקום
  const counts = new Map();
  (project.slots || []).forEach(slot => {
    (slot.scenes || []).forEach(scene => {
      const loc = (scene.location || "").trim();
      if (!loc) return;
      counts.set(loc, (counts.get(loc) || 0) + 1);
    });
  });
  if (counts.size === 0) return;

  const section = document.createElement("section");
  section.className = "minute-card locations-summary-section";
  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([loc, n]) => `<span class="location-chip">📍 ${loc} <b>×${n}</b></span>`)
    .join("");
  section.innerHTML = `
    <div class="minute-header">
      <h2 class="minute-title">מקומות בפרק (${counts.size})</h2>
      <span class="minute-time-range">סצנות לפי מיקום פיזי</span>
    </div>
    <div class="locations-chips">${chips}</div>
  `;
  tel.appendChild(section);
}

function renderProposedRef(ref) {
  const tpl = $("#proposedRefTemplate");
  const node = tpl.content.cloneNode(true);
  const root = $(".scene-card", node);
  
  const nameInput = $(".ref-name", root);
  nameInput.value = ref.name || "";
  
  const descTextarea = $(".ref-description", root);
  descTextarea.value = ref.description || "";
  
  const badge = $(".scene-status-badge", root);
  badge.textContent = "מוצע";
  badge.className = "scene-status-badge proposed";

  const img = $(".ref-image", root);
  const existing = references.find(r => r.name === ref.name);
  if (existing) {
        img.src = `/api/reference-image/${encodeURIComponent(existing.id)}`;
        img.classList.add("has");
        badge.textContent = "קיים באינדקס";
        badge.className = "scene-status-badge approved";
  }

  $(".generate-ref-btn", root).onclick = async () => {
      setStatus(`מייצר רפרנס ל-${nameInput.value}...`);
      try {
          const res = await api(`/api/project/${encodeURIComponent(currentMishna)}/create-reference-image`, {
              method: "POST",
              body: JSON.stringify({
                  name: nameInput.value,
                  description: descTextarea.value,
                  category: ref.category || "characters"
              })
          });
          references.push(res);
          renderGlobalRefs();
          renderTimeline();
          setStatus(`רפרנס ${res.name} נוצר ✓`, "ok");
      } catch (e) { setStatus("שגיאה: " + e.message, "err"); }
  };

  $(".approve-ref-btn", root).onclick = () => {
      project.slots.forEach(s => {
          if (s.new_references) s.new_references = s.new_references.filter(r => r.id !== ref.id);
      });
      renderTimeline();
      setStatus("רפרנס אושר", "ok");
  };

  return node;
}

function renderScene(minuteId, scene, sceneNumber) {
  const tpl = $("#sceneTemplate");
  const node = tpl.content.cloneNode(true);
  const root = $(".scene-card", node);
  root.dataset.minuteId = minuteId;
  root.dataset.sceneId = scene.scene_id;
  $(".scene-number", root).textContent = `סצנה ${sceneNumber}`;
  $(".scene-time", root).textContent = scene.start && scene.end ? `${scene.start} → ${scene.end}` : "";
  const badge = $(".scene-status-badge", root);
  badge.textContent = statusLabel(scene.status);
  badge.className = "scene-status-badge " + scene.status;
  const locInput = $(".location-text", root);
  if (locInput) {
    locInput.value = scene.location || "";
    locInput.onchange = () => saveScene(minuteId, scene.scene_id, root);
  }
  $(".mishna-text", root).value = scene.mishna_text || "";
  $(".mishna-text", root).onchange = () => saveScene(minuteId, scene.scene_id, root);
  $(".prompt-text", root).value = scene.prompt || "";
  $(".prompt-text", root).onchange = () => saveScene(minuteId, scene.scene_id, root);
  
  const hasMissing = renderChips($(".ref-chips-container", root), scene.references || []);
  if (hasMissing) {
      const missingBadge = document.createElement("span");
      missingBadge.className = "scene-status-badge missing-refs";
      missingBadge.textContent = "חסרים רפרנסים";
      missingBadge.style.marginRight = "5px";
      $(".scene-header", root).appendChild(missingBadge);
  }

  const img = $(".scene-image", root);
  if (scene.image_path) {
    img.src = `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${scene.scene_id}/image?t=${Date.now()}`;
    img.classList.add("has");
  }
  $(".ai-prompt-btn", root).onclick = () => askClaudeSingle(minuteId, scene.scene_id, root);
  $(".save-scene-btn", root).onclick = () => saveScene(minuteId, scene.scene_id, root);
  $(".edit-refs-btn", root).onclick = () => openRefModal(minuteId, scene.scene_id);
  $(".generate-btn", root).onclick = () => generateScene(minuteId, scene.scene_id);
  $(".approve-btn", root).onclick = () => approveScene(minuteId, scene.scene_id);
  
  const editBtn = $(".edit-scene-advanced-btn", root);
  if (editBtn) {
      editBtn.onclick = () => openEditSceneModal(minuteId, scene.scene_id);
  }
  
  root.ondblclick = () => openEditSceneModal(minuteId, scene.scene_id);
  
  return node;
}

function statusLabel(s) {
  return { proposed: "מוצע", approved: "מאושר", needs_regen: "ליצירה מחדש", image_ready: "תמונה מוכנה", image_approved: "מאושר ✓" }[s] || s;
}

function renderChips(container, refs) {
  if (!container) return;
  container.innerHTML = "";
  if (!refs || refs.length === 0) {
    container.innerHTML = '<span style="font-size: 11px; color: var(--muted);">אין רפרנסים</span>';
    return;
  }
  let hasMissing = false;
  refs.forEach((r) => {
    let searchId = r;
    let searchName = null;
    if (r.includes("|")) {
      const parts = r.split("|");
      searchId = parts[0].trim();
      searchName = parts[1].trim();
    }

    const meta = references.find((x) => 
      x.id === searchId || 
      x.name === searchId || 
      x.file === searchId ||
      (searchName && (x.id === searchName || x.name === searchName || x.file === searchName))
    );

    const span = document.createElement("span");
    if (searchId === "scene:previous") {
      span.className = "chip scene-ref";
      span.textContent = "📸 סצנה קודמת";
    } else if (searchId.startsWith("scene:")) {
        span.className = "chip scene-ref";
        span.textContent = `🎬 ${searchId.replace("scene:", "")}`;
    } else if (meta) {
      span.className = "chip";
      span.textContent = meta.name;
    } else {
      span.className = "chip missing";
      span.textContent = `⚠️ ${r}`;
      span.title = "רפרנס חסר במאגר";
      hasMissing = true;
    }
    container.appendChild(span);
  });
  return hasMissing;
}

function findMinuteSlot(minuteId) { return (project.slots || []).find((m) => m.id === minuteId); }
function findScene(minuteId, sceneId) {
  const minute = findMinuteSlot(minuteId);
  return minute ? (minute.scenes || []).find((s) => s.scene_id === sceneId) : null;
}
function findSceneCard(minuteId, sceneId) { return $(`.scene-card[data-minute-id="${minuteId}"][data-scene-id="${sceneId}"]`); }

async function openEditSceneModal(minuteId, sceneId) {
    editModalMinuteId = minuteId;
    editModalSceneId = sceneId;
    const scene = findScene(minuteId, sceneId);
    if (!scene) return;

    $("#editSceneTimeLabel").textContent = `${scene.start} → ${scene.end}`;
    $("#editSceneLocation").value = scene.location || "";
    $("#editSceneMishnaText").value = scene.mishna_text || "";
    $("#editScenePrompt").value = scene.prompt || "";
    $("#editSceneStart").value = scene.start || "";
    $("#editSceneEnd").value = scene.end || "";
    $("#editSceneEffect").value = scene.effect || "ken_burns";
    $("#editSceneIntensity").value = scene.intensity || "medium";
    $("#editSceneFullPrompt").value = "";
    $("#editSceneFullPrompt").placeholder = "טוען פרומפט מלא...";

    const img = $("#editSceneImage");
    if (scene.image_path) {
        img.src = `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/image?t=${Date.now()}`;
        img.classList.add("has");
    } else {
        img.src = "";
        img.classList.remove("has");
    }

    renderChips($("#editSceneRefs"), scene.references || []);
    
    const autoPrevRef = $("#autoPrevSceneRef");
    if (autoPrevRef) {
        autoPrevRef.checked = (scene.references || []).includes("scene:previous");
    }

    $("#editSceneModal").classList.remove("hidden");

    await initWavesurfer(scene.start, scene.end);

    refreshGeminiPrompt();
}

async function refreshGeminiPrompt() {
    try {
        const res = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${editModalMinuteId}/scene/${editModalSceneId}/gemini-prompt`);
        $("#editSceneFullPrompt").value = res.full_prompt;
        const styleEl = $("#editSceneStyle");
        if (styleEl) styleEl.value = res.style_description || "";
    } catch (e) {
        $("#editSceneFullPrompt").value = "שגיאה בטעינת פרומפט: " + e.message;
    }
}

$("#refreshGeminiPromptBtn").onclick = refreshGeminiPrompt;

function timestampToSeconds(ts) {
    if (!ts) return 0;
    const parts = ts.split(":");
    if (parts.length !== 3) return 0;
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const s = parseFloat(parts[2]);
    return h * 3600 + m * 60 + s;
}

function secondsToTimestamp(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

$("#saveEditSceneBtn").onclick = async () => {
    const scene = findScene(editModalMinuteId, editModalSceneId);
    const oldEnd = scene.end;
    const newEnd = $("#editSceneEnd").value;
    const newStart = $("#editSceneStart").value;

    const autoPrevRef = $("#autoPrevSceneRef");
    let currentRefs = scene.references || [];
    if (autoPrevRef && autoPrevRef.checked) {
        if (!currentRefs.includes("scene:previous")) {
            currentRefs.push("scene:previous");
        }
    } else if (autoPrevRef) {
        currentRefs = currentRefs.filter(r => r !== "scene:previous");
    }

    const body = {
        mishna_text: $("#editSceneMishnaText").value,
        prompt: $("#editScenePrompt").value,
        location: $("#editSceneLocation").value,
        effect: $("#editSceneEffect").value,
        intensity: $("#editSceneIntensity").value,
        start: newStart,
        end: newEnd,
        references: currentRefs
    };

    try {
        setStatus("שומר סצנה...");
        const updated = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${editModalMinuteId}/scene/${editModalSceneId}`, {
            method: "PUT",
            body: JSON.stringify(body)
        });
        Object.assign(scene, updated);

        if (newEnd !== oldEnd) {
            applyRippleEdit(editModalMinuteId, editModalSceneId, newEnd);
        }

        renderTimeline();
        $("#editSceneModal").classList.add("hidden");
        setStatus("סצנה נשמרה וציר הזמן עודכן ✓", "ok");
    } catch (e) {
        setStatus("שגיאה בשמירה: " + e.message, "err");
    }
};

function applyRippleEdit(minuteId, sceneId, newEndStr) {
    const newEndSec = timestampToSeconds(newEndStr);
    let currentStartSec = newEndSec;
    let found = false;

    project.slots.forEach(slot => {
        (slot.scenes || []).forEach(s => {
            if (found) {
                const duration = timestampToSeconds(s.end) - timestampToSeconds(s.start);
                s.start = secondsToTimestamp(currentStartSec);
                s.end = secondsToTimestamp(currentStartSec + duration);
                currentStartSec = currentStartSec + duration;
            }
            if (s.scene_id === sceneId) {
                found = true;
            }
        });
    });
}

$("#generateWithFullPromptBtn").onclick = async () => {
    const fullPrompt = $("#editSceneFullPrompt").value;
    const body = {
        prompt: fullPrompt,
        is_full_prompt: true
    };
    
    try {
        setStatus("מייצר תמונה עם הפרומפט המלא...");
        const res = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${editModalMinuteId}/scene/${editModalSceneId}/generate`, {
            method: "POST",
            body: JSON.stringify(body)
        });
        
        const scene = findScene(editModalMinuteId, editModalSceneId);
        Object.assign(scene, res);
        
        const img = $("#editSceneImage");
        img.src = `/api/project/${encodeURIComponent(currentMishna)}/minute/${editModalMinuteId}/scene/${editModalSceneId}/image?t=${Date.now()}`;
        img.classList.add("has");
        
        renderTimeline();
        setStatus("תמונה חדשה נוצרה ✓", "ok");
    } catch (e) {
        setStatus("שגיאה ביצירה: " + e.message, "err");
    }
};

$("#addSceneBeforeBtn").onclick = async () => {
    await addSceneAt(editModalMinuteId, editModalSceneId, "before");
};

$("#addSceneAfterBtn").onclick = async () => {
    await addSceneAt(editModalMinuteId, editModalSceneId, "after");
};

$("#deleteSceneBtn").onclick = async () => {
    if (!confirm("למחוק את הסצנה? פעולה זו אינה הפיכה.")) return;
    try {
        setStatus("מוחק סצנה...");
        await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${editModalMinuteId}/scene/${editModalSceneId}`, {
            method: "DELETE"
        });
        await loadProject();
        $("#editSceneModal").classList.add("hidden");
        setStatus("הסצנה נמחקה ✓", "ok");
    } catch (e) {
        setStatus("שגיאה במחיקה: " + e.message, "err");
    }
};

async function addSceneAt(minuteId, sceneId, position) {
    try {
        setStatus("מוסיף סצנה חדשה...");
        await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/add-${position}`, {
            method: "POST"
        });
        await loadProject();
        $("#editSceneModal").classList.add("hidden");
        setStatus("סצנה חדשה נוספה ✓", "ok");
    } catch (e) {
        setStatus("שגיאה: " + e.message, "err");
    }
}

async function askClaudeSingle(minuteId, sceneId, root) {
  const instruction = prompt("הכנס הנחיה ל-Claude:");
  if (instruction === null) return;
  setStatus(`מבקש מ-Claude עבור סצנה ${sceneId}...`);
  try {
    const updated = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/repropose`, { method: "POST", body: JSON.stringify({ instruction }) });
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    $(".prompt-text", root).value = updated.prompt || "";
    renderChips($(".ref-chips-container", root), updated.references || []);
    const badge = $(".scene-status-badge", root);
    badge.textContent = statusLabel(updated.status);
    badge.className = "scene-status-badge " + updated.status;
    setStatus("עודכן בהצלחה מ-Claude ✓", "ok");
  } catch (e) { setStatus("שגיאת Claude: " + e.message, "err"); }
}

async function saveScene(minuteId, sceneId, root) {
  const body = { mishna_text: $(".mishna-text", root).value, prompt: $(".prompt-text", root).value };
  const locEl = $(".location-text", root);
  if (locEl) body.location = locEl.value;
  try {
    const updated = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}`, { method: "PUT", body: JSON.stringify(body) });
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    setStatus("נשמר ✓", "ok");
  } catch (e) { setStatus("שגיאה בשמירה: " + e.message, "err"); }
}

async function generateScene(minuteId, sceneId) {
  setStatus(`יוצר תמונה ל-${sceneId}...`);
  try {
    const updated = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/generate`, { method: "POST", body: JSON.stringify({}) });
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    const card = findSceneCard(minuteId, sceneId);
    if (card) {
      const img = $(".scene-image", card);
      img.src = `/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/image?t=${Date.now()}`;
      img.classList.add("has");
      const badge = $(".scene-status-badge", card);
      badge.textContent = statusLabel(updated.status);
      badge.className = "scene-status-badge " + updated.status;
    }
    setStatus("תמונה נוצרה ✓", "ok");
  } catch (e) { setStatus("שגיאה: " + e.message, "err"); }
}

async function approveScene(minuteId, sceneId) {
  try {
    const updated = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${minuteId}/scene/${sceneId}/approve`, { method: "POST", body: JSON.stringify({}) });
    const scene = findScene(minuteId, sceneId);
    if (scene) Object.assign(scene, updated);
    const card = findSceneCard(minuteId, sceneId);
    if (card) {
      const badge = $(".scene-status-badge", card);
      badge.textContent = statusLabel(updated.status);
      badge.className = "scene-status-badge " + updated.status;
    }
    setStatus("אושר ✓", "ok");
  } catch (e) { setStatus("שגיאה: " + e.message, "err"); }
}

function openRefModal(minuteId, sceneId) {
  refModalMinuteId = minuteId; refModalSceneId = sceneId;
  const scene = findScene(minuteId, sceneId);
  const selected = new Set(scene.references || []);
  const grid = $("#refGrid");
  grid.innerHTML = "";
  references.forEach((r) => {
    const item = document.createElement("div");
    item.className = "ref-item" + (selected.has(r.id) ? " sel" : "");
    item.dataset.id = r.id;
    item.innerHTML = `<img src="/api/reference-image/${encodeURIComponent(r.id)}" alt=""/><div>${r.name}</div>`;
    item.onclick = () => item.classList.toggle("sel");
    grid.appendChild(item);
  });
  $("#refModal").classList.remove("hidden");
}

$("#refSave").onclick = async () => {
  const chosen = $$("#refGrid .ref-item.sel").map((el) => el.dataset.id);
  try {
    const updated = await api(`/api/project/${encodeURIComponent(currentMishna)}/minute/${refModalMinuteId}/scene/${refModalSceneId}`, { method: "PUT", body: JSON.stringify({ references: chosen }) });
    const scene = findScene(refModalMinuteId, refModalSceneId);
    if (scene) Object.assign(scene, updated);
    const card = findSceneCard(refModalMinuteId, refModalSceneId);
    if (card) renderChips($(".ref-chips-container", card), updated.references || []);
    setStatus("רפרנסים עודכנו ✓", "ok");
  } catch (e) { setStatus("שגיאה: " + e.message, "err"); }
  $("#refModal").classList.add("hidden");
};
$("#refCancel").onclick = () => $("#refModal").classList.add("hidden");

$("#editSceneRefsBtn").onclick = () => openRefModal(editModalMinuteId, editModalSceneId);

$("#addPrevSceneRefBtn").onclick = () => {
    const scene = findScene(editModalMinuteId, editModalSceneId);
    if (!scene.references) scene.references = [];
    if (!scene.references.includes("scene:previous")) {
        scene.references.push("scene:previous");
        renderChips($("#editSceneRefs"), scene.references);
        const autoPrevRef = $("#autoPrevSceneRef");
        if (autoPrevRef) autoPrevRef.checked = true;
    }
};

$("#mishnaSelect").onchange = loadProject;

$("#uploadAudioBtn").onclick = async () => {
    const fileInput = $("#projectAudio");
    if (!fileInput.files.length) return alert("יש לבחור קובץ אודיו");
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    setStatus("מעלה אודיו...");
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/audio`, { method: "POST", body: fd });
      const data = await res.json();
      project.audio_path = data.audio_path;
      $("#audioUploadContainer").classList.remove("missing-audio");
      $("#audioStatusLabel").textContent = "שמע קיים ✓";
      audio.src = `/api/project/${encodeURIComponent(currentMishna)}/audio?t=${Date.now()}`;
      setStatus("אודיו הועלה בהצלחה ✓", "ok");
    } catch(e) { setStatus("שגיאה בהעלאת אודיו: " + e.message, "err"); }
};

$("#uploadSrtBtn").onclick = async () => {
    const fileInput = $("#projectSrt");
    if (!fileInput.files.length) return alert("יש לבחור קובץ SRT");
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    setStatus("מעלה SRT...");
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/srt`, { method: "POST", body: fd });
      const data = await res.json();
      project.srt_path = data.srt_path;
      $("#srtUploadContainer").classList.remove("missing-audio");
      $("#srtStatusLabel").textContent = "SRT קיים ✓";
      setStatus("SRT הועלה בהצלחה ✓", "ok");
      await loadProject();
    } catch(e) { setStatus("שגיאה בהעלאת SRT: " + e.message, "err"); }
};

$("#directorInstructionsBtn").onclick = () => $("#directorModal").classList.remove("hidden");
$("#dirCancel").onclick = () => $("#directorModal").classList.add("hidden");
$("#dirSave").onclick = async () => {
  const txt = $("#directorInstructionsText").value.trim();
  try {
    await api(`/api/project/${encodeURIComponent(currentMishna)}`, { method: "PUT", body: JSON.stringify({ director_instructions: txt }) });
    project.director_instructions = txt;
    $("#directorModal").classList.add("hidden");
    setStatus("הוראות נשמרו ✓", "ok");
  } catch(e) { setStatus("שגיאה: " + e.message, "err"); }
};

$("#styleSettingsBtn").onclick = () => {
    const grid = $("#styleRefGrid");
    grid.innerHTML = "";
    const selected = new Set(project.style_references || []);
    references.forEach(r => {
        const item = document.createElement("div");
        item.className = "ref-item" + (selected.has(r.id) ? " sel" : "");
        item.dataset.id = r.id;
        item.innerHTML = `<img src="/api/reference-image/${encodeURIComponent(r.id)}" alt=""/><div>${r.name}</div>`;
        item.onclick = () => item.classList.toggle("sel");
        grid.appendChild(item);
    });
    $("#styleModal").classList.remove("hidden");
};
$("#styleCancel").onclick = () => $("#styleModal").classList.add("hidden");
$("#styleSave").onclick = async () => {
    const txt = $("#styleDescriptionText").value.trim();
    const refs = $$("#styleRefGrid .ref-item.sel").map(el => el.dataset.id);
    try {
        await api(`/api/project/${encodeURIComponent(currentMishna)}`, { method: "PUT", body: JSON.stringify({ style_description: txt, style_references: refs }) });
        project.style_description = txt;
        project.style_references = refs;
        $("#styleModal").classList.add("hidden");
        setStatus("הגדרות סגנון נשמרו ✓", "ok");
    } catch(e) { setStatus("שגיאה: " + e.message, "err"); }
};

$("#showPromptBtn").onclick = async () => {
  try {
    const res = await api(`/api/project/${encodeURIComponent(currentMishna)}/prompt-preview`);
    $("#previewPromptText").value = res.prompt;
    $("#showPromptModal").classList.remove("hidden");
  } catch(e) { setStatus("שגיאה: " + e.message, "err"); }
};

$("#savePromptBtn").onclick = async () => {
  const customPrompt = $("#previewPromptText").value.trim();
  $("#showPromptModal").classList.add("hidden");
  await runProposeStream(customPrompt);
};
$("#closePromptBtn").onclick = () => $("#showPromptModal").classList.add("hidden");

$("#newProjectBtn").onclick = () => {
  $("#npId").value = ""; $("#npPlot").value = ""; $("#npSrt").value = "";
  $("#newProjectModal").classList.remove("hidden");
};
$("#npCancel").onclick = () => $("#newProjectModal").classList.add("hidden");
$("#npSave").onclick = async () => {
  const body = { mishna_id: $("#npId").value.trim(), plot: $("#npPlot").value.trim(), srt_text: $("#npSrt").value.trim(), images_per_minute: parseInt($("#npIpm").value) || 4 };
  if (!body.mishna_id || !body.srt_text) return alert("חובה להזין מזהה פרויקט ו-SRT");
  try {
    await api("/api/project/create", { method: "POST", body: JSON.stringify(body) });
    $("#newProjectModal").classList.add("hidden");
    await loadMishnayotList(body.mishna_id);
  } catch(e) { setStatus("שגיאה: " + e.message, "err"); }
};

function renderUrExtraFields() {
    const cat = $("#urCat").value;
    const container = $("#urExtraFields");
    container.innerHTML = "";
    if (cat === "characters") {
        container.innerHTML = `
            <label>גיל: <input type="text" id="urAge" placeholder="למשל: 40"></label>
            <label>גובה: <input type="text" id="urHeight" placeholder="גבוה ורזה"></label>
        `;
    } else if (cat === "style") {
        container.innerHTML = `
            <label>אווירה: <input type="text" id="urMood" placeholder="מואר, עתיק"></label>
            <label>שעה: <input type="text" id="urTime" placeholder="צהריים"></label>
        `;
    } else if (cat === "items") {
        container.innerHTML = `
            <label>חומר: <input type="text" id="urMaterial" placeholder="זהב, חרס"></label>
            <label>מצב: <input type="text" id="urCondition" placeholder="חדש, שבור"></label>
        `;
    }
}
$("#urCat").onchange = renderUrExtraFields;

$("#uploadRefBtn").onclick = () => {
    $("#urFile").value = ""; $("#urName").value = ""; $("#urDesc").value = "";
    $("#urCat").value = "characters";
    renderUrExtraFields();
    $("#uploadRefModal").classList.remove("hidden");
};
$("#urSave").onclick = async () => {
  const fileInput = $("#urFile");
  if (!fileInput.files.length) return alert("יש לבחור קובץ תמונה");
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("name", $("#urName").value.trim());
  fd.append("description", $("#urDesc").value.trim());
  fd.append("category", $("#urCat").value);
  
  const body = {
      age: $("#urAge")?.value,
      height: $("#urHeight")?.value,
      mood: $("#urMood")?.value,
      time_of_day: $("#urTime")?.value,
      material: $("#urMaterial")?.value,
      condition: $("#urCondition")?.value,
  };

  try {
    const res = await fetch("/api/references", { method: "POST", body: fd });
    const newRef = await res.json();
    
    await api(`/api/references/${encodeURIComponent(newRef.id)}`, { method: "PUT", body: JSON.stringify(body) });
    Object.assign(newRef, body);

    references.push(newRef);
    renderGlobalRefs();
    $("#uploadRefModal").classList.add("hidden");
  } catch(e) { setStatus("שגיאה: " + e.message, "err"); }
};
$("#manageRefsBtn").onclick = () => { renderRefsTable(); $("#manageRefsModal").classList.remove("hidden"); };
$("#closeRefsModalBtn").onclick = () => $("#manageRefsModal").classList.add("hidden");
$("#urCancel").onclick = () => $("#uploadRefModal").classList.add("hidden");

async function runProposeStream(customPrompt = null) {
  const ipm = parseFloat($("#ipm").value) || 4;
  const mode = $("#workMode").value;
  setStatus("Claude ממלא סצנות...");
  const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/propose-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
        images_per_minute: ipm, 
        custom_prompt: customPrompt,
        style_description: project.style_description,
        style_references: project.style_references
    }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "minute") {
        const minute = ev.minute;
        const existing = findMinuteSlot(minute.id);
        if (existing) Object.assign(existing, minute);
        else project.slots = [minute];
      }
    }
  }
  renderTimeline();
  let hasNewRefs = false;
  project.slots.forEach(s => { if (s.new_references && s.new_references.length > 0) hasNewRefs = true; });
  if (hasNewRefs && (mode === "semi" || mode === "manual")) {
      setStatus("Claude הציע רפרנסים חדשים. נא לאשר אותם.", "ok");
      renderRefsTable();
      $("#manageRefsModal").classList.remove("hidden");
  } else {
      setStatus("Claude סיים ✓", "ok");
      if (mode === "auto") runGenerateAll();
  }
}

async function createPendingReferences() {
  let newRefsFound = [];
  project.slots.forEach(s => {
    if (s.new_references) newRefsFound.push(...s.new_references);
  });

  if (newRefsFound.length > 0) {
    setStatus(`יוצר ${newRefsFound.length} רפרנסים חדשים...`);
    for (const nr of newRefsFound) {
      if (references.find(r => r.name === nr.name)) continue;
      await api(`/api/project/${encodeURIComponent(currentMishna)}/create-reference-image`, {
        method: "POST",
        body: JSON.stringify({
          name: nr.name,
          description: nr.description,
          category: nr.category || "characters"
        })
      });
    }
    const refsData = await api("/api/references");
    references = (refsData && refsData.references) || [];
    renderGlobalRefs();
    project.slots.forEach(s => {
      if (s.new_references) s.new_references = [];
    });
    renderTimeline();
    return true;
  }
  return false;
}

async function runGenerateAll() {
  const mode = $("#workMode").value;

  const createdAny = await createPendingReferences();
  
  if (createdAny && mode !== "auto") {
    setStatus("רפרנסים חדשים נוצרו. בדוק אותם לפני המשך ליצירת תמונות.", "ok");
    setStep(inferStep());
    return;
  }

  for (const minute of project.slots || []) {
    for (const scene of minute.scenes || []) {
      if (!scene.image_path) {
        await generateScene(minute.id, scene.scene_id);
        if (mode === "manual") {
          setStatus(`תמונה ל-${scene.scene_id} נוצרה. ממתין לאישור...`, "ok");
          setStep(inferStep());
          return;
        }
      }
    }
  }
  setStep(inferStep());
}

async function runBuild() {
  if (!project.audio_path) return alert("חובה להעלות אודיו!");
  $("#videoPanel").classList.remove("hidden");
  $("#buildLogs").innerHTML = "מתחיל הרכבה...\n";
  const res = await fetch(`/api/project/${encodeURIComponent(currentMishna)}/build`, { method: "POST" });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    $("#buildLogs").innerHTML += decoder.decode(value, { stream: true });
    $("#buildLogs").scrollTop = $("#buildLogs").scrollHeight;
  }
  const videoUrl = `/api/project/${encodeURIComponent(currentMishna)}/video?t=${Date.now()}`;
  $("#resultVideo").src = videoUrl;
  $("#videoResultContainer").classList.remove("hidden");
  $("#downloadVideoBtn").href = videoUrl;
  setStatus("הוידאו הורכב ✓", "ok");
}

$("#nextStepBtn").onclick = async () => {
  $("#nextStepBtn").disabled = true;
  try {
    if (currentStep === "transcription") {
      await runProposeStream();
      setStep(inferStep());
    } else if (currentStep === "content") {
      setStep(inferStep());
    } else if (currentStep === "references") {
      await createPendingReferences();
      setStep("images");
    } else if (currentStep === "images") {
      await runGenerateAll();
      setStep("video");
    } else if (currentStep === "video") {
      await runBuild();
    }
  } catch (e) {
    setStatus("שגיאה: " + e.message, "err");
  } finally {
    if (currentStep !== "video") $("#nextStepBtn").disabled = false;
  }
};

$("#proposeBtn").onclick = () => runProposeStream();
$("#generateAllBtn").onclick = () => runGenerateAll();
$("#buildBtn").onclick = () => runBuild();

window.addEventListener("DOMContentLoaded", init);