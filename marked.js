/**
 * Hand-coded lightweight Markdown Parser (marked.js replacement)
 * Specifically designed for AngelFirewall Security project aesthetics.
 */

export const marked = {
    Renderer: class {
        constructor() {
            this.parser = {
                parse: (tokens) => this.renderTokens(tokens),
                parseInline: (tokens) => this.renderTokens(tokens)
            };
        }

        escapeHtml(text) {
            if (!text) return '';
            return text.replace(/[&<>"']/g, m => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;',
                '"': '&quot;', "'": '&#39;'
            }[m]));
        }

        sanitizeUrl(url) {
            if (!url || url.length > 2048) return '#';
            const trimmed = url.trim();
            const lower = trimmed.toLowerCase();

            // Block dangerous schemes
            const dangerousSchemes = ['javascript:', 'vbscript:', 'data:text/html'];
            if (dangerousSchemes.some(scheme => lower.startsWith(scheme))) {
                return '#';
            }

            // Strict data URI allowlist
            if (lower.startsWith('data:')) {
                const allowedDataTypes = [
                    'data:image/png;base64,',
                    'data:image/jpeg;base64,',
                    'data:image/jpg;base64,',
                    'data:image/gif;base64,',
                    'data:image/webp;base64,'
                ];
                if (!allowedDataTypes.some(prefix => lower.startsWith(prefix))) {
                    return '#';
                }
                const commaIndex = trimmed.indexOf(',');
                if (commaIndex === -1) return '#';
                const base64Part = trimmed.substring(commaIndex + 1);
                if (!/^[A-Za-z0-9+/=]+$/.test(base64Part)) {
                    return '#';
                }
            }

            // Allow only http(s) and safe data: URIs
            if (!lower.startsWith('http://') &&
                !lower.startsWith('https://') &&
                !lower.startsWith('data:image/')) {
                return '#';
            }

            return trimmed;
        }

        renderTokens(tokens) {
            if (!tokens) return '';
            return tokens.map(t => {
                if (t.type === 'text') return t.text;
                if (t.type === 'image') return this.image(t);
                if (t.type === 'link') {
                    const href = this.sanitizeUrl(t.href);
                    const title = this.escapeHtml(t.title || '');
                    return `<a href="${href}"${title ? ` title="${title}"` : ''}>${this.renderTokens(t.tokens)}</a>`;
                }
                if (t.type === 'strong') return `<strong>${this.renderTokens(t.tokens)}</strong>`;
                if (t.type === 'em') return `<em>${this.renderTokens(t.tokens)}</em>`;
                if (t.type === 'codespan') return `<code>${t.text}</code>`;
                return t.text || '';
            }).join('');
        }

        heading(text, level) {
            const safeLevel = Math.max(1, Math.min(6, parseInt(level) || 1));
            return `<h${safeLevel} class="blog-h${safeLevel}">${text}</h${safeLevel}>`;
        }

        paragraph(text) {
            return `<p class="blog-p">${text}</p>`;
        }

        blockquote(text) {
            return `<blockquote class="blog-blockquote">${text}</blockquote>`;
        }

        hr() {
            return `<hr class="blog-hr">`;
        }

        image(token) {
            const src = this.sanitizeUrl(token.href);
            const alt = this.escapeHtml(token.text || '');
            const title = this.escapeHtml(token.title || '');
            return `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''}>`;
        }
        // ... [tables, list, listitem, code remain similar but should use Object.create(null) for tokens later]

        table(token) {
            return `<table><thead>...</thead><tbody>...</tbody></table>`;
        }

        list(token) {
            const type = token.ordered ? 'ol' : 'ul';
            const items = token.items || [];
            const itemsHtml = items.map(item => this.listitem(item)).join('');
            return `<${type} class="blog-ul">${itemsHtml}</${type}>`;
        }

        listitem(token) {
            // Parse inline markdown in list items (bold, links, etc.)
            const html = token.tokens ? this.renderTokens(token.tokens) : (token.text || '');
            return `<li class="blog-li">${html}</li>`;
        }

        code(token) {
            return `<pre><code>${token.text}</code></pre>`;
        }
    },

    use: function (options) {
        if (options.renderer) {
            this._renderer = Object.assign(this._renderer || new this.Renderer(), options.renderer);
            this._renderer.parser = {
                parse: (tokens) => this._renderer.renderTokens(tokens),
                parseInline: (tokens) => this._renderer.renderTokens(tokens)
            };
        }
        if (options.extensions) {
            this._extensions = (this._extensions || []).concat(options.extensions);
        }
    },

    _renderer: null,
    _extensions: [],

    parse: function (src) {
        if (!this._renderer) this._renderer = new this.Renderer();
        const renderer = this._renderer;

        // Step 1: Normalize line endings
        let text = src.replace(/\r\n/g, '\n');

        // Step 2: Extract Block Tokens
        let html = '';
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (!line.trim() && !line.startsWith('```')) continue;

            // 1. Code Blocks
            if (line.startsWith('```')) {
                let codeLang = line.slice(3).trim();
                let codeContent = '';
                i++;
                while (i < lines.length && !lines[i].startsWith('```')) {
                    codeContent += lines[i] + '\n';
                    i++;
                }
                const token = Object.create(null);
                token.type = 'code';
                token.text = codeContent.trim();
                token.lang = codeLang;
                html += renderer.code(token);
                continue;
            }

            // 2. Headings
            if (line.startsWith('#')) {
                const levelMatch = line.match(/^#+/);
                const level = levelMatch[0].length;
                const content = line.slice(level).trim();
                html += renderer.heading(this.parseInline(content), level);
                continue;
            }

            // 3. HR
            if (line.trim() === '---' || line.trim() === '***') {
                html += renderer.hr();
                continue;
            }

            // 4. Blockquotes
            if (line.startsWith('>')) {
                let quoteText = line.slice(1).trim();
                html += renderer.blockquote(this.parseInline(quoteText));
                continue;
            }

            // 5. Tables
            const isSeparatorLine = (l) => {
                const trimmed = l?.trim();
                if (!trimmed || trimmed.length > 1000) return false;

                const cells = trimmed.split('|').filter(Boolean);
                if (cells.length === 0 || cells.length > 50) return false;

                return cells.every(c => {
                    const clean = c.trim();
                    if (clean.length === 0 || clean.length > 100) return false;
                    let stripped = clean.startsWith(':') ? clean.slice(1) : clean;
                    stripped = stripped.endsWith(':') ? stripped.slice(0, -1) : stripped;

                    for (let i = 0; i < stripped.length; i++) {
                        if (stripped[i] !== '-') return false;
                    }
                    return stripped.length > 0;
                });
            };

            const MAX_TABLE_ROWS = 1000;
            if (line.includes('|') && lines[i + 1] && isSeparatorLine(lines[i + 1])) {
                let headerLine = line;
                let nextIdx = i + 1;

                if (nextIdx < lines.length && isSeparatorLine(lines[nextIdx])) {
                    let sepLine = lines[nextIdx];
                    i = nextIdx; // advance to separator

                    const getCells = (l) => {
                        let row = l.trim();
                        if (row.startsWith('|')) row = row.slice(1);
                        if (row.endsWith('|')) row = row.slice(0, -1);
                        return row.split('|').map(c => c.trim());
                    };

                    const headerCells = getCells(headerLine);
                    const sepCells = getCells(sepLine);

                    const alignments = sepCells.map(s => {
                        if (s.startsWith(':') && s.endsWith(':')) return 'center';
                        if (s.endsWith(':')) return 'right';
                        if (s.startsWith(':')) return 'left';
                        return null;
                    });

                    let headerTokens = headerCells.map((c, idx) => ({
                        text: c,
                        tokens: this.tokenizeInline(c),
                        align: alignments[idx] || null
                    }));

                    let rows = [];
                    let rowCount = 0;
                    while (i + 1 < lines.length && rowCount < MAX_TABLE_ROWS) {
                        i++;
                        rowCount++;
                        if (!lines[i].trim()) continue; // skip blank lines between rows
                        if (!lines[i].includes('|')) { i--; break; } // end of table

                        let rowCells = getCells(lines[i]);
                        // Fix for extra column: truncate or pad to match header length exactly
                        rowCells = rowCells.slice(0, headerTokens.length);
                        while (rowCells.length < headerTokens.length) rowCells.push('');

                        rows.push(rowCells.map((c, idx) => ({
                            text: c,
                            tokens: this.tokenizeInline(c),
                            align: alignments[idx] || null
                        })));
                    }
                    const token = Object.create(null);
                    token.type = 'table';
                    token.header = headerTokens;
                    token.rows = rows;
                    html += renderer.table(token);
                    continue;
                }
            }

            // 6. Lists
            if (line.match(/^\s*[\-\*]\s/)) {
                let items = [];
                while (i < lines.length && lines[i].match(/^\s*[\-\*]\s/)) {
                    let itemText = lines[i].replace(/^\s*[\-\*]\s/, '');
                    const token = Object.create(null);
                    token.text = itemText;
                    token.tokens = this.tokenizeInline(itemText);
                    token.task = false;
                    items.push(token);
                    i++;
                }
                i--;
                const token = Object.create(null);
                token.type = 'list';
                token.ordered = false;
                token.items = items;
                html += renderer.list(token);
                continue;
            }

            // 7. Paragraphs
            html += renderer.paragraph(this.parseInline(line));
        }

        return html;
    },

    tokenizeInline: function (text) {
        // Very basic tokenizer for bold, image, link
        let tokens = [];
        let curr = text;

        while (curr) {
            // Images ![alt](url)
            let imgMatch = curr.match(/^!\[(.*?)\]\((.*?)\)/);
            if (imgMatch) {
                const token = Object.create(null);
                token.type = 'image';
                token.text = imgMatch[1];
                token.href = imgMatch[2];
                tokens.push(token);
                curr = curr.slice(imgMatch[0].length);
                continue;
            }

            // Links [text](url)
            let linkMatch = curr.match(/^\[(.*?)\]\((.*?)\)/);
            if (linkMatch) {
                // Check if any extensions handle this (like the button)
                let handled = false;
                for (let ext of this._extensions) {
                    if (ext.tokenizer) {
                        let res = ext.tokenizer(curr, []);
                        if (res && typeof res === 'object' && res.type) {
                            const token = Object.create(null);
                            // Strict whitelist copy to prevent prototype pollution and unexpected keys
                            const allowedKeys = ['type', 'raw', 'text', 'href'];
                            for (const key of allowedKeys) {
                                if (Object.prototype.hasOwnProperty.call(res, key)) {
                                    token[key] = res[key];
                                }
                            }
                            tokens.push(token);
                            curr = curr.slice(res.raw.length);
                            handled = true;
                            break;
                        }
                    }
                }
                if (handled) continue;

                const token = Object.create(null);
                token.type = 'link';
                token.text = linkMatch[1];
                token.href = linkMatch[2];
                token.tokens = this.tokenizeInline(linkMatch[1]);
                tokens.push(token);
                curr = curr.slice(linkMatch[0].length);
                continue;
            }

            // Bold **text**
            let boldMatch = curr.match(/^\*\*(.{1,200}?)\*\*/);
            if (boldMatch) {
                const token = Object.create(null);
                token.type = 'strong';
                token.text = boldMatch[1];
                token.tokens = this.tokenizeInline(boldMatch[1]);
                tokens.push(token);
                curr = curr.slice(boldMatch[0].length);
                continue;
            }

            // Italic *text* (must come after bold check)
            let italicMatch = curr.match(/^\*(.{1,200}?)\*/);
            if (italicMatch) {
                const token = Object.create(null);
                token.type = 'em';
                token.text = italicMatch[1];
                token.tokens = this.tokenizeInline(italicMatch[1]);
                tokens.push(token);
                curr = curr.slice(italicMatch[0].length);
                continue;
            }

            // Code `text`
            let codeMatch = curr.match(/^`(.{1,200}?)`/);
            if (codeMatch) {
                const token = Object.create(null);
                token.type = 'codespan';
                token.text = codeMatch[1];
                tokens.push(token);
                curr = curr.slice(codeMatch[0].length);
                continue;
            }

            // Text
            tokens.push({ type: 'text', text: curr[0] });
            curr = curr.slice(1);
        }

        // Merge adjacent text tokens
        let merged = [];
        for (let t of tokens) {
            if (t.type === 'text' && merged.length > 0 && merged[merged.length - 1].type === 'text') {
                merged[merged.length - 1].text += t.text;
            } else {
                merged.push(t);
            }
        }
        return merged;
    },

    parseInline: function (text) {
        if (!this._renderer) this._renderer = new this.Renderer();
        const tokens = this.tokenizeInline(text);

        return tokens.map(token => {
            // Check extensions
            for (let ext of this._extensions) {
                if (ext.name === token.type && ext.renderer) {
                    return ext.renderer(token);
                }
            }
            // Standard render
            if (token.type === 'text') return token.text;
            if (token.type === 'strong') return `<strong>${this.parseInline(token.text)}</strong>`;
            if (token.type === 'em') return `<em>${this.parseInline(token.text)}</em>`;
            if (token.type === 'codespan') return `<code>${token.text}</code>`;
            if (token.type === 'link') return `<a href="${token.href}">${this.parseInline(token.text)}</a>`;
            if (token.type === 'image') return this._renderer.image(token);
            return token.text || '';
        }).join('');
    }
};
