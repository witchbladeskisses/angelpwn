import { connectLanyard, disconnectLanyard } from './ws.js';
import { initBlog } from './blog.js';

(function () {
    // Configuration
    const DISCORD_ID = '775390352470179900';

    const preloader = document.getElementById('preloader');
    const bentoContainer = document.querySelector('.bento-container');

    // --- State & Intervals ---
    const scrambleIntervals = new WeakMap();
    let timeInterval = null;
    let spotifyRafId = null;
    let cursorRafId = null;
    let titleInterval = null;
    let lastSpotifyData = null;
    let blogController = null;

    const listeners = [];
    function addListener(target, event, handler, options) {
        if (!target) return;
        target.addEventListener(event, handler, options);
        listeners.push({ target, event, handler, options });
    }

    function cleanup() {
        listeners.forEach(({ target, event, handler, options }) => {
            target.removeEventListener(event, handler, options);
        });
        listeners.length = 0;
        if (timeInterval) clearInterval(timeInterval);
        if (spotifyRafId) cancelAnimationFrame(spotifyRafId);
        if (cursorRafId) cancelAnimationFrame(cursorRafId);
        if (titleInterval) clearInterval(titleInterval);
        disconnectLanyard();
        tiltInstances.forEach(instance => instance && instance.destroy && instance.destroy());
        if (tiltObserver) tiltObserver.disconnect();
        if (blogController && blogController.destroy) blogController.destroy();
    }

    // --- Dynamic Document Title ---
    const titleFrames = ['  ', ' / ', ' /\\ ', ' A ', ' A| ', ' A|\\ ', ' A|\\| ', ' A|\\| ', ' An ', ' An@ ', ' Ang ', ' Ang3 ', ' Ange ', ' Ange| ', ' Ange|2 ', ' Ange|_ ', ' Angel ', ' Angel| ', ' Angel|> ', ' Angelp ', ' Angelp\/ ', ' Angelp\/\/ ', ' Angelpw', ' Angelpw|', ' Angelpw|\\ ', ' Angelpw|\\', ' Angelpw|\\|', ' Angelpwn', ' Angelpwn.', ' Angelpwn.<', ' Angelpwn.c', ' Angelpwn.c<', ' Angelpwn.cc', ' Angelpwn.cc', ' Angelpwn.cc', ' Angelpwn.cc', ' Angelpwn.c<', ' Angelpwn.c', ' Angelpwn.<', ' Angelpwn.', ' Angelpwn', ' Angelpw|\\|', ' Angelpw|\\', ' Angelpw|\\ ', ' Angelpw|', ' Angelpw', ' Angelp\/\/ ', ' Angelp\/ ', ' Angelp ', ' Angel|>', ' Angel| ', ' Angel ', ' Ange|_ ', ' Ange|2 ', ' Ange| ', ' Ange ', ' Ang3 ', ' Ang ', ' An@ ', ' An ', ' A|\\| ', ' A|\\ ', ' A|\\ ', ' A| ', ' A ', ' /\\ ', ' / ', ' | ', '  ', ''];
    let titleFrame = 0;

    // PGP data cache
    let pgpMetaCache = null;
    let pgpKeyCache = null;

    const spotifyLabel = document.getElementById('spotify-song');
    const spotifyArtistLabel = document.getElementById('spotify-artist');
    let lastTrackId = null;
    let tiltInstances = [];
    let tiltObserver = null;

    const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+';
    let pgpLoading = false;

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function scrambleText(element, finalText) {
        if (!element || element.textContent === finalText) return;
        const existing = scrambleIntervals.get(element);
        if (existing) clearInterval(existing);

        let iteration = 0;
        const duration = 1000;
        const intervalTime = 30;
        const totalSteps = duration / intervalTime;
        const increment = finalText.length / totalSteps;

        element.dataset.text = "";
        const interval = setInterval(() => {
            if (!document.body.contains(element)) {
                clearInterval(interval);
                scrambleIntervals.delete(element);
                return;
            }

            const currentScramble = finalText.split('')
                .map((char, index) => {
                    if (index < iteration) return finalText[index];
                    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
                })
                .join('');

            element.innerText = currentScramble;
            element.dataset.text = currentScramble;

            if (iteration >= finalText.length) {
                clearInterval(interval);
                scrambleIntervals.delete(element);
                element.innerText = finalText;
                element.dataset.text = finalText;
            }
            iteration += increment;
        }, intervalTime);
        scrambleIntervals.set(element, interval);
    }

    // --- Preloader ---
    const loaderWord1 = document.getElementById('loader-word-1');
    const loaderWord2 = document.getElementById('loader-word-2');

    if (loaderWord1) { loaderWord1.innerText = ""; loaderWord1.dataset.text = ""; }
    if (loaderWord2) { loaderWord2.innerText = ""; loaderWord2.dataset.text = ""; }

    function simulateLoading() {
        setTimeout(() => {
            if (loaderWord1) scrambleText(loaderWord1, "ANGELFIREWALL");
            if (loaderWord2) scrambleText(loaderWord2, "SECURITY");
        }, 100);
        setTimeout(() => {
            preloader.classList.add('loader-exit');
            if (window.animateGlobeIn) window.animateGlobeIn();
            setTimeout(() => {
                preloader.style.display = 'none';
                bentoContainer.classList.add('visible');
            }, 600);
        }, 1500);
    }

    simulateLoading();

    // --- Time ---
    function updateTime() {
        if (document.hidden) return;
        const now = new Date();
        const timeDisplay = document.getElementById('current-time');
        const dateDisplay = document.getElementById('current-date');
        const timeParent = timeDisplay?.parentElement;

        if (timeDisplay) timeDisplay.textContent = now.toLocaleTimeString('en-US', { hour12: false });
        if (dateDisplay) dateDisplay.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        if (timeParent && timeParent.tagName === 'TIME') {
            timeParent.setAttribute('datetime', now.toISOString());
        }
    }
    updateTime();
    timeInterval = setInterval(updateTime, 1000);

    // --- Spotify Progress & Presence Update ---
    const avatarImg = document.getElementById('discord-avatar');
    const statusDot = document.getElementById('discord-status-indicator');
    const usernameEl = document.getElementById('discord-username');
    const bioTextEl = document.querySelector('.bio-text');
    const activityName = document.getElementById('activity-name');
    const activityDetails = document.getElementById('activity-details');
    const activityState = document.getElementById('activity-state');
    const activityImage = document.getElementById('activity-image');
    const spotifySong = document.getElementById('spotify-song');
    const spotifyArtist = document.getElementById('spotify-artist');
    const spotifyArt = document.getElementById('spotify-art');
    const spotifyProgress = document.getElementById('spotify-progress');
    const spotifyBg = document.getElementById('spotify-bg');

    function updateSpotifyProgressLocal() {
        const spotify = lastSpotifyData;
        if (!spotify || !spotify.timestamps || !spotifyProgress) return;

        const start = spotify.timestamps.start;
        const end = spotify.timestamps.end;
        const total = end - start;
        if (total <= 0) {
            spotifyProgress.style.width = '0%';
            return;
        }
        const current = Date.now() - start;
        const percent = Math.max(0, Math.min((current / total) * 100, 100));

        if (current > total + 5000) {
            lastSpotifyData = null;
            if (spotifyLabel) scrambleText(spotifyLabel, "Not Playing");
            if (spotifyArtistLabel) scrambleText(spotifyArtistLabel, "Spotify");
            spotifyProgress.style.width = "0%";
            return;
        }
        spotifyProgress.style.width = `${percent}%`;
    }

    function startSpotifyProgress() {
        if (spotifyRafId) cancelAnimationFrame(spotifyRafId);
        function update() {
            updateSpotifyProgressLocal();
            spotifyRafId = requestAnimationFrame(update);
        }
        spotifyRafId = requestAnimationFrame(update);
    }

    let lastAvatarUrl = '';
    let lastStatus = '';
    let lastUsername = '';

    function handlePresenceUpdate(data) {
        const state = data.data || data;
        const user = state.discord_user;
        if (!user) return;

        const avatarId = user.avatar;
        const userId = user.id;
        if (avatarId && avatarImg) {
            const format = avatarId.startsWith('a_') ? 'gif' : 'png';
            const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatarId}.${format}`;
            if (avatarUrl !== lastAvatarUrl) {
                avatarImg.src = avatarUrl;
                lastAvatarUrl = avatarUrl;
            }
        }

        const currentUsername = user.display_name || user.username;
        if (currentUsername !== lastUsername && usernameEl) {
            usernameEl.textContent = currentUsername;
            lastUsername = currentUsername;
        }

        if (state.discord_status !== lastStatus && statusDot) {
            statusDot.className = `status-dot ${state.discord_status}`;
            lastStatus = state.discord_status;
        }

        const activities = state.activities || [];
        const spotify = activities.find(a => a.id === 'spotify:1');
        const game = activities.find(a => a.type === 0);
        const custom = activities.find(a => a.type === 4);

        lastSpotifyData = spotify;

        if (bioTextEl) {
            const newBio = (custom && custom.state) ? custom.state : "Reverse engineer & Malware dev";
            if (bioTextEl.textContent !== newBio) {
                bioTextEl.textContent = newBio;
            }
        }

        const spotifyDefault = document.getElementById('spotify-default-art');
        if (spotify) {
            const currentTrackId = spotify.sync_id || spotify.details + spotify.state;
            if (currentTrackId !== lastTrackId) {
                scrambleText(spotifyLabel, spotify.details);
                scrambleText(spotifyArtistLabel, spotify.state);
                lastTrackId = currentTrackId;
            }
            if (spotify.assets && spotify.assets.large_image && spotifyArt && spotifyDefault && spotifyBg) {
                const artId = spotify.assets.large_image.includes(':') ? spotify.assets.large_image.split(':')[1] : spotify.assets.large_image;
                const artUrl = `https://i.scdn.co/image/${artId}`;
                spotifyArt.src = artUrl;
                spotifyArt.classList.remove('hidden');
                spotifyDefault.classList.add('hidden');
                spotifyBg.style.backgroundImage = `url(${artUrl})`;
            }
        } else {
            if (lastTrackId !== null) {
                scrambleText(spotifyLabel, "Not Playing");
                scrambleText(spotifyArtistLabel, "Spotify");
                lastTrackId = null;
            }
            if (spotifyProgress) spotifyProgress.style.width = "0%";
            if (spotifyArt) spotifyArt.classList.add('hidden');
            if (spotifyDefault) spotifyDefault.classList.remove('hidden');
            if (spotifyBg) spotifyBg.style.backgroundImage = 'none';
        }

        const activityDefaultIcon = document.getElementById('activity-default-icon');
        if (game && activityName && activityDetails && activityState) {
            activityName.textContent = game.name;
            activityDetails.textContent = game.details || "Playing";
            activityState.textContent = game.state || "";

            if (game.assets && game.assets.large_image && activityImage) {
                activityImage.classList.remove('hidden');
                if (activityDefaultIcon) activityDefaultIcon.classList.add('hidden');
                let imgUrl = game.assets.large_image;
                if (imgUrl.startsWith('mp:')) {
                    imgUrl = `https://media.discordapp.net/${imgUrl.replace('mp:', '')}`;
                } else {
                    imgUrl = `https://cdn.discordapp.com/app-assets/${game.application_id}/${imgUrl}.png`;
                }
                activityImage.src = imgUrl;
            } else if (game.application_id && activityImage) {
                activityImage.classList.remove('hidden');
                if (activityDefaultIcon) activityDefaultIcon.classList.add('hidden');
                activityImage.src = `https://dcdn.dstn.to/app-icons/${game.application_id}`;
            } else {
                if (activityImage) activityImage.classList.add('hidden');
                if (activityDefaultIcon) activityDefaultIcon.classList.remove('hidden');
            }
        } else {
            if (activityName) activityName.textContent = "No Activity";
            if (activityDetails) activityDetails.textContent = "Idle";
            if (activityState) activityState.textContent = "";
            if (activityImage) activityImage.classList.add('hidden');
            if (activityDefaultIcon) activityDefaultIcon.classList.add('hidden');
        }
    }

    // --- Visibility management ---
    addListener(document, 'visibilitychange', () => {
        if (document.hidden) {
            if (titleInterval) clearInterval(titleInterval);
            if (spotifyRafId) cancelAnimationFrame(spotifyRafId);
            if (cursorRafId) cancelAnimationFrame(cursorRafId);
            disconnectLanyard();
            if (timeInterval) clearInterval(timeInterval);
            cursorRafId = null;
        } else {
            if (timeInterval) clearInterval(timeInterval);
            timeInterval = setInterval(updateTime, 1000);
            startSpotifyProgress();
            connectLanyard(DISCORD_ID, handlePresenceUpdate);
            if (!cursorRafId) animateCursor();

            if (titleInterval) clearInterval(titleInterval);
            titleInterval = setInterval(() => {
                document.title = titleFrames[titleFrame] || 'Angelpwn.cc';
                titleFrame = (titleFrame + 1) % titleFrames.length;
            }, 550);
        }
    });

    connectLanyard(DISCORD_ID, handlePresenceUpdate);
    startSpotifyProgress();

    // --- Cursor ---
    const cursorDot = document.querySelector('.cursor-dot');
    const cursorOutline = document.querySelector('.cursor-outline');
    let mouseX = 0, mouseY = 0, outlineX = 0, outlineY = 0;
    let lastMouseUpdate = 0;
    const mouseThrottle = 16;
    addListener(window, 'mousemove', (e) => {
        const now = performance.now();
        if (now - lastMouseUpdate >= mouseThrottle) {
            mouseX = e.clientX; mouseY = e.clientY;
            lastMouseUpdate = now;
        }
    });

    function animateCursor() {
        if (!cursorDot || !cursorOutline) return;
        outlineX += (mouseX - outlineX) * 0.15;
        outlineY += (mouseY - outlineY) * 0.15;
        cursorDot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%)`;
        cursorOutline.style.transform = `translate3d(${outlineX}px, ${outlineY}px, 0) translate(-50%, -50%)`;
        cursorRafId = requestAnimationFrame(animateCursor);
    }
    animateCursor();

    const hoverables = document.querySelectorAll('a, button, .card, .project-item, .glass-icon, input');
    hoverables.forEach(el => {
        addListener(el, 'mouseenter', () => document.body.classList.add('hovering'));
        addListener(el, 'mouseleave', () => document.body.classList.remove('hovering'));
    });

    // --- Terminal ---
    const termToggle = document.getElementById('terminal-toggle');
    const termWindow = document.getElementById('terminal-window');
    const closeBtn = document.querySelector('.close-btn');
    const cliInput = document.getElementById('cli-input');
    const cliOutput = document.getElementById('cli-output');
    let previousTermActiveElement = null;

    addListener(termToggle, 'click', () => {
        previousTermActiveElement = document.activeElement;
        termWindow.classList.remove('hidden');
        termWindow.setAttribute('aria-hidden', 'false');
        cliInput?.focus();
    });

    function closeTerminal() {
        termWindow.classList.add('hidden');
        termWindow.setAttribute('aria-hidden', 'true');
        if (previousTermActiveElement && previousTermActiveElement.focus) previousTermActiveElement.focus();
    }
    addListener(closeBtn, 'click', closeTerminal);

    addListener(cliInput, 'keydown', (e) => {
        if (e.key === 'Enter') {
            const cmd = cliInput.value.trim();

            // 10. Terminal Sanitization: Length limit & Block control/BiDi characters
            if (cmd.length > 512) {
                const err = document.createElement('div');
                err.style.color = 'var(--error-glow)';
                err.textContent = 'Error: Command too long';
                cliOutput.appendChild(err);
                cliInput.value = '';
                return;
            }

            if (cmd) {
                const safeCmd = cmd.replace(/[\u0000-\u001F\u202A-\u202E\u2066-\u2069]/g, '');

                const line = document.createElement('div');
                line.textContent = `root@system:~$ ${safeCmd}`;
                cliOutput.appendChild(line);
                const resp = document.createElement('div');
                resp.style.color = '#888';
                if (safeCmd === 'help') resp.textContent = "Commands: help, clear, whoami";
                else if (safeCmd === 'clear') { cliOutput.innerHTML = ''; return; }
                else if (safeCmd === 'whoami') resp.textContent = "root";
                else resp.textContent = `Command not found: ${safeCmd}`;
                cliOutput.appendChild(resp);
                cliInput.value = '';
                cliOutput.scrollTop = cliOutput.scrollHeight;
            }
        }
    });

    // --- PGP Modal ---
    const pgpToggle = document.getElementById('pgp-toggle');
    const pgpModal = document.getElementById('pgp-modal');
    const pgpClose = document.getElementById('pgp-close');
    const copyPgpBtn = document.getElementById('copy-pgp-btn');
    const downloadPgpBtn = document.getElementById('download-pgp-btn');
    const pgpKeyBlock = document.getElementById('pgp-key-block');

    addListener(pgpToggle, 'click', async () => {
        if (pgpLoading) return;
        pgpLoading = true;
        try {
            if (!pgpMetaCache) {
                const metaResponse = await fetch('pgp-meta.json');
                if (!metaResponse.ok) throw new Error('Failed to load PGP metadata');
                pgpMetaCache = await metaResponse.json();
            }
            if (!pgpKeyCache) {
                const keyResponse = await fetch('pgp-key.asc');
                if (!keyResponse.ok) throw new Error('Failed to load PGP key');
                pgpKeyCache = await keyResponse.text();
            }

            pgpModal.querySelector('.modal-title').textContent = pgpMetaCache.title;
            pgpModal.querySelector('.modal-subtitle').textContent = pgpMetaCache.subtitle;
            pgpModal.querySelector('.crypto-note').textContent = pgpMetaCache.note;
            const keySelection = pgpModal.querySelector('.pgp-key-section');
            keySelection.querySelector('.label').textContent = pgpMetaCache.labels.publicKey;
            keySelection.querySelector('#copy-pgp-btn').textContent = pgpMetaCache.labels.copy;
            keySelection.querySelector('#download-pgp-btn').textContent = pgpMetaCache.labels.download;
            keySelection.querySelector('#pgp-key-block code').textContent = pgpKeyCache;
            const tutorial = pgpModal.querySelector('.tutorial-section');
            tutorial.querySelector('h3').textContent = pgpMetaCache.tutorialTitle;
            const steps = tutorial.querySelectorAll('li');
            steps[0].textContent = pgpMetaCache.steps[0];
            steps[1].textContent = pgpMetaCache.steps[1];

            // Safe way to inject fingerprint
            steps[2].textContent = pgpMetaCache.steps[2];
            const codeEl = document.createElement('code');
            codeEl.className = 'mono';
            codeEl.textContent = pgpMetaCache.fingerprint;
            steps[2].appendChild(codeEl);

            steps[3].textContent = pgpMetaCache.steps[3];
            pgpModal.classList.remove('hidden');
            pgpModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        } catch (error) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error-notification';
            errorMsg.textContent = 'Failed to load PGP data. Please try again later.';
            pgpModal.querySelector('.modal-body')?.prepend(errorMsg);
            setTimeout(() => errorMsg.remove(), 5000);
        } finally {
            pgpLoading = false;
        }
    });

    function closePgpModal() {
        pgpModal.classList.add('hidden');
        pgpModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
    addListener(pgpClose, 'click', () => closePgpModal());
    addListener(pgpModal?.querySelector('.modal-backdrop'), 'click', () => closePgpModal());

    addListener(copyPgpBtn, 'click', () => {
        const keyText = pgpKeyBlock.innerText;
        navigator.clipboard.writeText(keyText).then(() => {
            const originalText = copyPgpBtn.innerText;
            copyPgpBtn.innerText = 'Copied!';
            copyPgpBtn.classList.add('success');
            setTimeout(() => { copyPgpBtn.innerText = originalText; copyPgpBtn.classList.remove('success'); }, 2000);
        });
    });

    addListener(downloadPgpBtn, 'click', () => {
        const keyText = pgpKeyBlock.innerText;
        const blob = new Blob([keyText], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'publickey.asc';
        document.body.appendChild(a); a.click();
        window.URL.revokeObjectURL(url); document.body.removeChild(a);
    });

    // --- Copy Email ---
    const copyEmailBtn = document.getElementById('copy-email');
    if (copyEmailBtn) {
        addListener(copyEmailBtn, 'click', (e) => {
            e.preventDefault();
            navigator.clipboard.writeText('syscall@tutamail.com').then(() => {
                const icon = copyEmailBtn.querySelector('i');
                const originalClass = icon.className;
                icon.className = 'fa-solid fa-check';
                copyEmailBtn.classList.add('success-text');
                setTimeout(() => {
                    icon.className = originalClass;
                    copyEmailBtn.classList.remove('success-text');
                }, 2000);
            });
        });
    }

    // --- Tilt ---
    // Refined detection: Disable tilt on mobile-sized screens OR touch-only devices.
    // This ensures it works on PCs with touchscreens (which also have fine pointers).
    const isMobileSize = window.innerWidth <= 768;
    const isTouchOnly = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;

    if (!isMobileSize && !isTouchOnly && typeof VanillaTilt !== 'undefined') {
        const cards = document.querySelectorAll('.card[data-tilt-js]');
        if (cards.length > 0) {
            tiltObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !entry.target.dataset.tiltInitialized) {
                        VanillaTilt.init(entry.target, { max: 5, speed: 400, glare: true, 'max-glare': 0.1 });
                        entry.target.dataset.tiltInitialized = 'true';
                        if (entry.target.vanillaTilt) tiltInstances.push(entry.target.vanillaTilt);
                        tiltObserver.unobserve(entry.target);
                    }
                });
            }, { rootMargin: '50px' });
            cards.forEach(card => tiltObserver.observe(card));
        }
    }

    // --- Blog ---
    blogController = initBlog();

    // --- Global ESC handler ---
    addListener(document, 'keydown', (e) => {
        if (e.key === 'Escape') {
            if (!pgpModal.classList.contains('hidden')) closePgpModal();
            else if (blogController && blogController.isOpen()) blogController.close();
            else if (termWindow && !termWindow.classList.contains('hidden')) closeTerminal();
        }
    });

    // --- Initialize Title ---
    if (titleInterval) clearInterval(titleInterval);
    titleInterval = setInterval(() => {
        document.title = titleFrames[titleFrame] || 'Angelpwn.cc';
        titleFrame = (titleFrame + 1) % titleFrames.length;
    }, 550);

    // --- Cleanup ---
    addListener(window, 'beforeunload', cleanup);

    // --- Global Error Handler ---
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
        // Можно добавить отправку ошибок на сервер мониторинга
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
    });
})();
