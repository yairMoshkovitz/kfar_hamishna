// Book Studio JS Client-side logic
let currentBook = null;
let allMishnayot = [];

// DOM Elements
const bookListEl = document.getElementById('bookList');
const emptyStateEl = document.getElementById('emptyState');
const editorContentEl = document.getElementById('editorContent');
const currentBookTitleEl = document.getElementById('currentBookTitle');
const importedFromLabelEl = document.getElementById('importedFromLabel');
const pagesCountLabelEl = document.getElementById('pagesCountLabel');
const bookStyleDescriptionEl = document.getElementById('bookStyleDescription');
const pagesSequenceEl = document.getElementById('pagesSequence');
const statusEl = document.getElementById('status');

// Create Book Modal Elements
const createBookModalEl = document.getElementById('createBookModal');
const cbTitleInput = document.getElementById('cbTitle');
const sourceScratchRadio = document.getElementById('sourceScratch');
const sourceProjectRadio = document.getElementById('sourceProject');
const projectSelectContainer = document.getElementById('projectSelectContainer');
const cbProjectSelect = document.getElementById('cbProjectSelect');

// Print Preview Elements
const studioAreaEl = document.getElementById('studioArea');
const printPreviewAreaEl = document.getElementById('printPreviewArea');
const printPagesContainer = document.getElementById('printPagesContainer');

// On load
document.addEventListener('DOMContentLoaded', () => {
  loadBooks();
  loadMishnayot();
  setupEventListeners();
});

function showStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${type} show`;
  setTimeout(() => {
    statusEl.classList.remove('show');
  }, 4000);
}

// APIs
async function loadBooks() {
  try {
    const res = await fetch('/api/books');
    const books = await res.json();
    renderBookList(books);
  } catch (err) {
    console.error('Error loading books:', err);
    showStatus('שגיאה בטעינת הספרים', 'error');
  }
}

async function loadMishnayot() {
  try {
    const res = await fetch('/api/mishnayot');
    allMishnayot = await res.json();
    populateMishnayotDropdowns();
  } catch (err) {
    console.error('Error loading mishnayot:', err);
  }
}

function populateMishnayotDropdowns() {
  cbProjectSelect.innerHTML = allMishnayot
    .map(m => `<option value="${m.mishna_id}">${m.title} (${m.mishna_id})</option>`)
    .join('');
}

function renderBookList(books) {
  if (books.length === 0) {
    bookListEl.innerHTML = `<div style="text-align: center; color: #aaa; padding: 20px;">אין ספרים עדיין.</div>`;
    return;
  }
  
  bookListEl.innerHTML = books
    .map(b => `
      <div class="book-list-item ${currentBook && currentBook.book_id === b.book_id ? 'active' : ''}" data-id="${b.book_id}">
        <div>
          <h4>${b.title}</h4>
          <span style="font-size: 10px; color: #888; display: block; margin-top: 3px;">
            ${b.created_from_mishna ? `יובא מ: ${b.created_from_mishna}` : 'ספר עצמאי'}
          </span>
        </div>
        <span>${b.pages_count} עמ'</span>
      </div>
    `)
    .join('');

  // Add click handlers
  document.querySelectorAll('.book-list-item').forEach(item => {
    item.addEventListener('click', () => {
      selectBook(item.dataset.id);
    });
  });
}

async function selectBook(bookId) {
  try {
    showStatus('טוען ספר...');
    const res = await fetch(`/api/book/${bookId}`);
    if (!res.ok) throw new Error('Failed to load book');
    currentBook = await res.json();
    
    // Update active class in sidebar
    document.querySelectorAll('.book-list-item').forEach(item => {
      item.classList.toggle('active', item.dataset.id === bookId);
    });

    renderBookEditor();
  } catch (err) {
    console.error(err);
    showStatus('שגיאה בטעינת הספר', 'error');
  }
}

function renderBookEditor() {
  if (!currentBook) return;

  emptyStateEl.classList.add('hidden');
  editorContentEl.classList.remove('hidden');

  currentBookTitleEl.textContent = currentBook.title;
  importedFromLabelEl.textContent = currentBook.created_from_mishna 
    ? `🔗 יובא מפרויקט: ${currentBook.created_from_mishna}` 
    : '📖 ספר עצמאי';
  pagesCountLabelEl.textContent = `📄 ${currentBook.pages.length} עמודים`;
  bookStyleDescriptionEl.value = currentBook.style_description || '';

  renderPages();
}

function renderPages() {
  pagesSequenceEl.innerHTML = '';
  
  if (currentBook.pages.length === 0) {
    pagesSequenceEl.innerHTML = `
      <div style="text-align: center; padding: 40px; border: 2px dashed #eee; border-radius: 8px; color: #aaa;">
        אין עמודים בספר זה עדיין. לחץ על "הוסף עמוד חדש" כדי להתחיל.
      </div>
    `;
    return;
  }

  currentBook.pages.forEach((page, index) => {
    const card = document.createElement('div');
    card.className = 'page-editor-card';
    card.dataset.pageId = page.page_id;

    const imgUrl = page.image_path 
      ? `/api/book/${currentBook.book_id}/page/${page.page_id}/image?t=${Date.now()}` 
      : '';

    card.innerHTML = `
      <!-- עמודה 1: מספרי עמודים -->
      <div class="page-number-col">
        <div>דף ${index + 1}</div>
        <div class="type-label">עמוד ${page.page_num}</div>
        
        <div class="page-nav-btns">
          <button class="secondary btn-xs move-up-btn" ${index === 0 ? 'disabled' : ''} title="העבר למעלה">▲</button>
          <button class="secondary btn-xs move-down-btn" ${index === currentBook.pages.length - 1 ? 'disabled' : ''} title="העבר למטה">▼</button>
          <button class="btn-xs delete-page-btn" style="background: #e74c3c; color: white; margin-top: 10px;" title="מחק עמוד">🗑️</button>
        </div>
      </div>

      <!-- עמודה 2: תוכן וטקסט ספרותי -->
      <div class="page-content-col">
        <div class="scene-section">
          <div class="text-area-label">
            <span>✍️ טקסט ספרותי לילדים (מוצג מול התמונה)</span>
            <button class="secondary btn-xs rewrite-ai-btn" style="background: #8e44ad; color: white;">🪄 שכתב סיפורת עם AI (Claude)</button>
          </div>
          <textarea class="story-textarea" placeholder="כתוב כאן את סיפור הדף לילדים קריא, קולח ומנוקד...">${page.text || ''}</textarea>
        </div>

        <div class="scene-section" style="margin-top: 5px;">
          <label class="text-area-label">🎨 הנחיות לתמונה (Prompt לתמונת העמוד):</label>
          <textarea class="prompt-textarea" placeholder="למשל: ילד לומד תורה עם סבא שלו בבית מדרש עתיק...">${page.prompt || ''}</textarea>
        </div>
      </div>

      <!-- עמודה 3: תצוגת תמונה והורדות/העלאות -->
      <div class="page-image-col">
        <div class="page-image-preview">
          ${page.image_path 
            ? `<img src="${imgUrl}" alt="Page Image" />` 
            : `<div class="image-placeholder">🖼️</div>`
          }
        </div>
        
        <div class="page-actions">
          <button class="accent btn-xs generate-page-img-btn">🎨 צור ב-Gemini</button>
          <label class="button secondary btn-xs" style="margin: 0; display: flex; align-items: center; justify-content: center;">
            📤 העלה תמונה
            <input type="file" class="upload-page-img-input" accept="image/*" style="display: none;">
          </label>
        </div>
      </div>
    `;

    // Event handlers for this card
    card.querySelector('.story-textarea').addEventListener('input', (e) => {
      page.text = e.target.value;
    });

    card.querySelector('.prompt-textarea').addEventListener('input', (e) => {
      page.prompt = e.target.value;
    });

    card.querySelector('.move-up-btn').addEventListener('click', () => {
      movePage(index, -1);
    });

    card.querySelector('.move-down-btn').addEventListener('click', () => {
      movePage(index, 1);
    });

    card.querySelector('.delete-page-btn').addEventListener('click', () => {
      deletePage(index);
    });

    card.querySelector('.rewrite-ai-btn').addEventListener('click', () => {
      rewriteTextWithAI(page, card);
    });

    card.querySelector('.generate-page-img-btn').addEventListener('click', () => {
      generateImageWithGemini(page, card);
    });

    card.querySelector('.upload-page-img-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        uploadImage(page, card, e.target.files[0]);
      }
    });

    pagesSequenceEl.appendChild(card);
  });
}

function movePage(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= currentBook.pages.length) return;
  
  // Swap
  const temp = currentBook.pages[index];
  currentBook.pages[index] = currentBook.pages[targetIndex];
  currentBook.pages[targetIndex] = temp;
  
  // Re-adjust page_num
  currentBook.pages.forEach((p, idx) => {
    p.page_num = idx + 1;
  });

  renderPages();
}

function deletePage(index) {
  if (!confirm('האם אתה בטוח שברצונך למחוק עמוד זה?')) return;
  currentBook.pages.splice(index, 1);
  
  // Re-adjust page_num
  currentBook.pages.forEach((p, idx) => {
    p.page_num = idx + 1;
  });

  renderPages();
}

async function rewriteTextWithAI(page, cardEl) {
  const btn = cardEl.querySelector('.rewrite-ai-btn');
  const originalText = cardEl.querySelector('.story-textarea').value;
  
  if (!originalText.trim()) {
    alert('אנא הזן טקסט בסיסי או רמז עלילתי כדי שקלוד יוכל לשכתב אותו!');
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = 'משכתב... 🪄';
    showStatus('מנסח מחדש טקסט סיפורי באמצעות Claude...');

    const res = await fetch(`/api/book/${currentBook.book_id}/page/${page.page_id}/rewrite-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original_text: originalText,
        prompt_context: page.prompt || ''
      })
    });

    if (!res.ok) throw new Error('Rewrite request failed');
    const data = await res.json();
    
    // Update data and textarea
    page.text = data.story_text;
    cardEl.querySelector('.story-textarea').value = data.story_text;
    
    showStatus('הטקסט שוכתב בהצלחה בסגנון ילדים!', 'ok');
  } catch (err) {
    console.error(err);
    showStatus('שגיאה בשכתוב הטקסט עם AI', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🪄 שכתב סיפורת עם AI (Claude)';
  }
}

async function generateImageWithGemini(page, cardEl) {
  const btn = cardEl.querySelector('.generate-page-img-btn');
  const prompt = cardEl.querySelector('.prompt-textarea').value;

  if (!prompt.trim()) {
    alert('אנא הזן פרומפט לתמונה של העמוד לפני הלחיצה על יצירה!');
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = 'מייצר... 🎨';
    showStatus('מחולל תמונה מרהיבה עם Gemini (עשוי לקחת כ-15-25 שניות)...');

    const res = await fetch(`/api/book/${currentBook.book_id}/page/${page.page_id}/generate-image?prompt=${encodeURIComponent(prompt)}`, {
      method: 'POST'
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || 'Generation failed');
    }
    
    const updatedBook = await res.json();
    currentBook = updatedBook;
    
    // Refresh only this page preview or rerender all
    renderPages();
    showStatus('התמונה חוללה ונוספה לעמוד!', 'ok');
  } catch (err) {
    console.error(err);
    showStatus(`שגיאה ביצירת התמונה: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🎨 צור ב-Gemini';
  }
}

async function uploadImage(page, cardEl, file) {
  try {
    showStatus('מעלה תמונה...');
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`/api/book/${currentBook.book_id}/page/${page.page_id}/upload-image`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error('Upload failed');
    const updatedBook = await res.json();
    currentBook = updatedBook;
    
    renderPages();
    showStatus('התמונה הועלתה בהצלחה!', 'ok');
  } catch (err) {
    console.error(err);
    showStatus('שגיאה בהעלאת התמונה', 'error');
  }
}

async function saveBook() {
  if (!currentBook) return;
  
  try {
    showStatus('שומר ספר...');
    
    const res = await fetch(`/api/book/${currentBook.book_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: currentBookTitleEl.textContent,
        style_description: bookStyleDescriptionEl.value,
        pages: currentBook.pages
      })
    });

    if (!res.ok) throw new Error('Save failed');
    currentBook = await res.json();
    
    showStatus('הספר נשמר בהצלחה!', 'ok');
    loadBooks(); // refresh list
  } catch (err) {
    console.error(err);
    showStatus('שגיאה בשמירת הספר', 'error');
  }
}

function addPage() {
  if (!currentBook) return;
  
  const page_id = `page-${Math.random().toString(36).substr(2, 6)}`;
  const page_num = currentBook.pages.length + 1;
  
  currentBook.pages.push({
    page_id,
    page_num,
    text: '',
    image_path: null,
    prompt: '',
    status: 'new'
  });

  renderPages();
  pagesCountLabelEl.textContent = `📄 ${currentBook.pages.length} עמודים`;
}

// Preview & Printing
function openPrintPreview() {
  if (!currentBook || currentBook.pages.length === 0) {
    alert('לא ניתן להציג ספר ללא עמודים!');
    return;
  }

  // Clear container
  printPagesContainer.innerHTML = '';

  // Generate facing pages
  // Page 1: Beautiful Cover page
  const coverPage = document.createElement('div');
  coverPage.className = 'print-page';
  coverPage.style.justifyContent = 'center';
  coverPage.innerHTML = `
    <h1 style="font-size: 50px; margin-bottom: 20px; color: #2c3e50; font-family: 'Assistant', sans-serif;">${currentBook.title}</h1>
    <h3 style="font-size: 20px; color: #7f8c8d; font-weight: normal;">ספר ילדים מאויר</h3>
    <div style="margin-top: 50px; font-size: 80px;">📚</div>
    <div style="margin-top: 50px; font-size: 16px; color: #95a5a6;">כפר המשנה — סטודיו ספרים</div>
  `;
  printPagesContainer.appendChild(coverPage);

  // Generate text page and image page sequentially
  currentBook.pages.forEach((page, index) => {
    // 1. Text Page
    const textPage = document.createElement('div');
    textPage.className = 'print-page text-page';
    textPage.innerHTML = `
      <div style="font-family: 'Assistant', sans-serif; padding: 0 10px; max-width: 90%;">
        ${page.text ? page.text.replace(/\n/g, '<br>') : '...'}
      </div>
      <div class="page-num-indicator">עמוד ${index * 2 + 1}</div>
    `;
    printPagesContainer.appendChild(textPage);

    // 2. Image Page
    const imagePage = document.createElement('div');
    imagePage.className = 'print-page image-page';
    
    const imgUrl = page.image_path 
      ? `/api/book/${currentBook.book_id}/page/${page.page_id}/image` 
      : '';

    imagePage.innerHTML = `
      ${page.image_path 
        ? `<img src="${imgUrl}" alt="סיפור" />` 
        : `<div style="font-size: 40px; color: #ccc;">🖼️ חסרה תמונה לדף</div>`
      }
      <div class="page-num-indicator">עמוד ${index * 2 + 2}</div>
    `;
    printPagesContainer.appendChild(imagePage);
  });

  // Switch views
  studioAreaEl.style.display = 'none';
  printPreviewAreaEl.style.display = 'flex';
}

function closePrintPreview() {
  studioAreaEl.style.display = 'block';
  printPreviewAreaEl.style.display = 'none';
}

// Modal management
function openCreateModal() {
  createBookModalEl.classList.remove('hidden');
  cbTitleInput.value = '';
  sourceScratchRadio.checked = true;
  projectSelectContainer.classList.add('hidden');
}

function closeCreateModal() {
  createBookModalEl.classList.add('hidden');
}

async function submitCreateBook() {
  const title = cbTitleInput.value.trim();
  if (!title) {
    alert('אנא הזן כותרת לספר!');
    return;
  }

  const useProject = sourceProjectRadio.checked;
  const import_mishna_id = useProject ? cbProjectSelect.value : null;

  try {
    showStatus('יוצר ספר חדש...');
    const res = await fetch('/api/book/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        import_mishna_id
      })
    });

    if (!res.ok) throw new Error('Create failed');
    const newBook = await res.json();
    
    closeCreateModal();
    showStatus('הספר נוצר בהצלחה!', 'ok');
    
    // Reload and select
    await loadBooks();
    selectBook(newBook.book_id);
  } catch (err) {
    console.error(err);
    showStatus('שגיאה ביצירת הספר', 'error');
  }
}

// Event Listeners setup
function setupEventListeners() {
  document.getElementById('createNewBookBtn').addEventListener('click', openCreateModal);
  document.getElementById('createNewBookCenterBtn').addEventListener('click', openCreateModal);
  
  document.getElementById('cbCancel').addEventListener('click', closeCreateModal);
  document.getElementById('cbSave').addEventListener('click', submitCreateBook);
  
  sourceScratchRadio.addEventListener('change', () => {
    projectSelectContainer.classList.add('hidden');
  });
  sourceProjectRadio.addEventListener('change', () => {
    projectSelectContainer.classList.remove('hidden');
  });

  document.getElementById('saveBookBtn').addEventListener('click', saveBook);
  document.getElementById('addPageBtn').addEventListener('click', addPage);
  document.getElementById('addPageBottomBtn').addEventListener('click', addPage);

  document.getElementById('previewBookBtn').addEventListener('click', openPrintPreview);
  document.getElementById('exitPreviewBtn').addEventListener('click', closePrintPreview);
  document.getElementById('triggerPrintBtn').addEventListener('click', () => {
    window.print();
  });
}
