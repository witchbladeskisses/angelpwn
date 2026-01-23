/**
 * Simplified Blog Module for Personal Site
 * Security-conscious but pragmatic for static content
 */

import { marked } from './marked.js';

// ==================== CONFIG ====================

const CONFIG = {
    endpoints: {
        meta: 'blog-meta.json',
        post: (id, lang) => lang === 'ru' ? `blog-${id}ru.md` : `blog-${id}.md`
    }
};

const i18n = {
    en: {
        loading: 'Loading...',
        error: 'Failed to load post',
        close: 'Close'
    },
    ru: {
        loading: 'Загрузка...',
        error: 'Ошибка загрузки',
        close: 'Закрыть'
    }
};

// ==================== STATE ====================

const state = {
    meta: null,
    lang: 'en',
    modalState: null,
    loading: false
};

// ==================== MARKED CONFIG ====================

// Basic security: escape HTML in code blocks, sanitize links
const renderer = new marked.Renderer();

renderer.link = function (token) {
    const href = token.href || '';

    // Block javascript: and data: protocols
    if (/^(javascript|data|vbscript):/i.test(href)) {
        return token.text || '';
    }

    const isExternal = /^https?:\/\//.test(href);
    const security = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

    return `<a href="${href}"${security}>${this.parser.parseInline(token.tokens)}</a>`;
};

renderer.image = function (token) {
    const src = token.href || '';

    // Allow http(s) images AND relative paths (for local images)
    // Block only dangerous protocols
    if (/^(javascript|data|vbscript):/i.test(src)) {
        return '';
    }

    const alt = token.text || 'Image';
    return `<img src="${src}" alt="${alt}" loading="lazy" class="blog-content-image">`;
};

// Download button extension
const buttonExtension = {
    name: 'button',
    level: 'inline',
    start(src) { return src.match(/\[button:/)?.index; },
    tokenizer(src) {
        const match = /^\[button:(.*?)\]\((.*?)\)/.exec(src);
        if (match) {
            return {
                type: 'button',
                raw: match[0],
                text: match[1],
                href: match[2]
            };
        }
    },
    renderer(token) {
        // Simple escaping for button text
        const text = token.text.replace(/[<>"']/g, '');
        return `<a href="${token.href}" class="blog-download-btn" download>
            <i class="fas fa-download"></i> ${text}
        </a>`;
    }
};

marked.use({
    renderer,
    extensions: [buttonExtension],
    breaks: false
});

// ==================== API ====================

async function loadMeta() {
    if (state.meta) return state.meta;

    try {
        const res = await fetch(CONFIG.endpoints.meta);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.meta = await res.json();
        return state.meta;
    } catch (err) {
        console.error('[Blog] Failed to load metadata:', err);
        throw err;
    }
}

async function loadPost(id, lang) {
    const url = CONFIG.endpoints.post(id, lang);

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch (err) {
        console.error(`[Blog] Failed to load ${url}:`, err);
        throw err;
    }
}

// ==================== UI ====================

function createBlogOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'blog-overlay hidden';

    overlay.innerHTML = `
        <div class="blog-overlay-backdrop"></div>
        <div class="blog-card-expanded premium-modal-base">
            <button class="blog-close-btn">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="blog-expanded-content">
                <h2 id="blog-expanded-title" class="blog-expanded-title"></h2>
                <span class="blog-expanded-date"></span>
                <div class="blog-text"></div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    return {
        overlay,
        expandedCard: overlay.querySelector('.blog-card-expanded'),
        closeBtn: overlay.querySelector('.blog-close-btn'),
        backdrop: overlay.querySelector('.blog-overlay-backdrop'),
        titleEl: overlay.querySelector('.blog-expanded-title'),
        dateEl: overlay.querySelector('.blog-expanded-date'),
        textEl: overlay.querySelector('.blog-text')
    };
}

function updateList(meta, openFn) {
    const list = document.querySelector('.blog-list');
    if (!list) return;

    const entries = Object.entries(meta);

    // Clear existing content
    list.innerHTML = '';

    // Create elements safely without innerHTML
    entries.forEach(([id, data]) => {
        const post = data[state.lang] || data.en || data;
        
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'blog-item';
        link.dataset.id = id;
        
        const dateSpan = document.createElement('span');
        dateSpan.className = 'blog-date';
        dateSpan.textContent = post.date || '';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'blog-title';
        titleSpan.textContent = post.title || 'Untitled';
        
        link.appendChild(dateSpan);
        link.appendChild(titleSpan);
        list.appendChild(link);
        
        link.addEventListener('click', e => {
            e.preventDefault();
            openFn(link);
        });
    });
}

// ==================== MAIN LOGIC ====================

async function openPost(item, elements) {
    if (state.loading) return;

    const id = item.dataset.id;
    const t = i18n[state.lang];

    state.loading = true;

    // Show loading state
    elements.titleEl.textContent = t.loading;
    elements.dateEl.textContent = '';
    elements.textEl.innerHTML = `<p>${t.loading}</p>`;

    // Open modal
    elements.overlay.classList.remove('hidden');
    elements.overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    state.modalState = { isOpen: true };

    try {
        // Load data
        const meta = await loadMeta();
        const postMeta = meta[id];

        if (!postMeta) throw new Error('Post not found');

        const langMeta = postMeta[state.lang] || postMeta.en || postMeta;
        const markdown = await loadPost(id, state.lang);

        // Render
        let html = marked.parse(markdown);

        // Optional: Use DOMPurify if loaded
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html);
        }

        // Update UI
        elements.titleEl.textContent = langMeta.title || 'Untitled';
        elements.dateEl.textContent = langMeta.date || '';
        elements.textEl.innerHTML = html;

        // Post loaded successfully

    } catch (err) {
        console.error('[Blog] Error:', err);
        elements.titleEl.textContent = t.error;
        elements.textEl.innerHTML = `<p class="text-error">${t.error}</p>`;
    } finally {
        state.loading = false;
    }
}

function closePost(elements) {
    if (state.modalState) {
        elements.overlay.classList.remove('active');
        elements.overlay.classList.add('hidden');
        document.body.style.overflow = '';
        state.modalState = null;
    }
}

// ==================== INIT ====================

export function initBlog() {
    const elements = createBlogOverlay();

    // Close handlers
    elements.closeBtn.onclick = () => closePost(elements);
    elements.backdrop.onclick = () => closePost(elements);

    // Language switcher
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const newLang = btn.dataset.lang;
            if (newLang === state.lang) return;

            state.lang = newLang;

            document.querySelectorAll('.lang-btn').forEach(b =>
                b.classList.remove('active')
            );
            btn.classList.add('active');

            const meta = await loadMeta();
            updateList(meta, item => openPost(item, elements));
        });
    });

    // Initial load
    loadMeta().then(meta => {
        updateList(meta, item => openPost(item, elements));
    }).catch(err => {
        console.error('[Blog] Init failed:', err);
    });

    return {
        close: () => closePost(elements),
        isOpen: () => state.modalState !== null
    };
}