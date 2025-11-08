document.addEventListener('DOMContentLoaded', () => {
  const logsContainer = document.getElementById('boot-logs');
  const memContainer = document.getElementById('memory-check');
  const progressBar = document.getElementById('progress-bar');
  const statusEl = document.getElementById('status');
  const promptEl = document.getElementById('click-prompt');
  const bootEl = document.getElementById('boot');
  const mainEl = document.getElementById('main');
  const toodaBtn = document.getElementById('team-tooda-btn');
  const toodaPanel = document.getElementById('team-tooda-panel');
  const citadelBtn = document.getElementById('citadel-btn');
  const citadelPanel = document.getElementById('citadel-panel');
  const bgAudio = document.getElementById('bg-audio');
  const bootLogo = document.getElementById('boot-logo');

  const bootLines = [
    { type: 'info', text: 'Loading kernel modules...' },
    { type: 'success', text: 'CPU: AMD Threadripper PRO 7995WX detected at 5.1 GHz' },
    { type: 'success', text: 'Memory: 64GB DDR5-6000 CL30 initialized' },
    { type: 'info', text: 'Running memory diagnostic...' },
    { type: 'success', text: 'Initializing PCI devices...' },
    { type: 'success', text: 'Loading system drivers: nvidia.ko, audio.ko, net.ko' },
    { type: 'warning', text: 'ACPI: Temperature threshold warning (CPU: 75°C)' },
    { type: 'info', text: 'Starting system services [1/3]...' },
    { type: 'info', text: 'Starting system services [2/3]...' },
    { type: 'info', text: 'Starting system services [3/3]...' },
  ];

  const logDelay = 100;
  bootLines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = `boot-log ${line.type}`;
    el.textContent = ` ${line.text}`;
    el.style.animationDelay = `${i * logDelay}ms`;
    setTimeout(() => {
      el.classList.add('show');
    }, 10);
    logsContainer.appendChild(el);
  });

  const blocks = 200;
  if (memContainer) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < blocks; i++) {
      const b = document.createElement('span');
      b.className = 'memory-block';
      b.style.animationDelay = `${(i * 20)}ms`;
      frag.appendChild(b);
    }
    memContainer.appendChild(frag);
  }

  progressBar.addEventListener('animationend', () => {
  });

    const finishBoot = () => {
    bootEl.classList.add('hidden');
    if (mainEl) {
      mainEl.classList.remove('hidden');
      try { mainEl.style.removeProperty('display'); } catch(e) {}
    }
    document.body.classList.add('ready');
    const menuHeader = document.querySelector('.menu-header');
    if (bootLogo && menuHeader) {
      menuHeader.insertBefore(bootLogo, menuHeader.firstChild);
      const nickEl = menuHeader.querySelector('.nick');
      [bootLogo, nickEl].forEach(el => {
        if (!el) return;
        el.classList.remove('sync-glow');
        el.style.animation = 'none';
      });
      void bootLogo.offsetWidth;
      if (menuHeader.querySelector('.nick')) void menuHeader.querySelector('.nick').offsetWidth;
      [bootLogo, menuHeader.querySelector('.nick')].forEach(el => {
        if (!el) return;
        el.style.animation = '';
        el.classList.add('sync-glow');
      });
      bootLogo.classList.add('logo-fade');
      setTimeout(() => bootLogo.classList.remove('logo-fade'), 1200);
    }
  };

  let continueBound = false;
  const enableContinue = () => {
    if (continueBound) return;
    continueBound = true;
    const clickHandler = () => {
      window.removeEventListener('click', clickHandler);
      window.removeEventListener('keydown', keyHandler);
      if (bgAudio) { try { bgAudio.volume = 0.025; bgAudio.play().catch(()=>{}); } catch(e){} }
      finishBoot();
    };
    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        window.removeEventListener('click', clickHandler);
        window.removeEventListener('keydown', keyHandler);
        if (bgAudio) { try { bgAudio.volume = 0.025; bgAudio.play().catch(()=>{}); } catch(e){} }
        finishBoot();
      }
    };
    window.addEventListener('click', clickHandler);
    window.addEventListener('keydown', keyHandler);
  };

  let animationReady = false;
  let pageLoaded = false;
  const tryEnable = () => { if (animationReady && pageLoaded) enableContinue(); };

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { animationReady = true; tryEnable(); }, prefersReducedMotion ? 300 : 4500);
  window.addEventListener('load', () => { pageLoaded = true; tryEnable(); });

  const triggerBtnFX = (btn, evt) => {
    if (!btn) return;
    try {
      btn.classList.remove('btn-press');
      void btn.offsetWidth;
      if (evt && evt.clientX != null) {
        const rect = btn.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        btn.style.setProperty('--x', `${x}px`);
        btn.style.setProperty('--y', `${y}px`);
      } else {
        btn.style.removeProperty('--x');
        btn.style.removeProperty('--y');
      }
      btn.classList.add('btn-press');
      setTimeout(() => btn.classList.remove('btn-press'), 460);
    } catch(e) {}
  };
  const setPanel = (show) => {
    if (!toodaPanel || !toodaBtn) return;
    if (show) {
      toodaPanel.classList.add('show');
      toodaPanel.setAttribute('aria-hidden', 'false');
      toodaBtn.setAttribute('aria-expanded', 'true');
    } else {
      toodaPanel.classList.remove('show');
      toodaPanel.setAttribute('aria-hidden', 'true');
      toodaBtn.setAttribute('aria-expanded', 'false');
    }
  };

  if (toodaBtn && toodaPanel) {
    let open = false;
    const toggle = () => {
      open = !open; setPanel(open);
      if (open && citadelPanel) {
        citadelPanel.classList.remove('show');
        citadelPanel.setAttribute('aria-hidden', 'true');
        if (citadelBtn) citadelBtn.setAttribute('aria-expanded', 'false');
      }
    };
    toodaBtn.addEventListener('click', (e) => { triggerBtnFX(toodaBtn, e); toggle(); });
    toodaBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerBtnFX(toodaBtn);
        toggle();
      }
    });
    document.addEventListener('click', (e) => {
      const po = document.getElementById('proof-overlay');
      if (po && po.classList.contains('show')) return;
      if (!open) return;
      const t = e.target;
      if (!toodaPanel.contains(t) && t !== toodaBtn) { open = false; setPanel(false); }
    });

    const names = ['Eco','Emo','Elo','user','Dante','Sevy'];
    const header = toodaPanel.querySelector('.team-list h2');
    if (header) header.textContent = 'TOoDA Team';
    const ul = toodaPanel.querySelector('.team-list .nick-list');
    if (ul) {
      ul.innerHTML = '';
      names.forEach(n => {
        const li = document.createElement('li');
        li.textContent = n;
        ul.appendChild(li);
      });
    }
    const storyWrap = toodaPanel.querySelector('.story');
    if (storyWrap) {
      const narrative = `On February 9, I warned a close associate connected to Doxbin moderator "Hardline" and gave them four days to fix a vulnerability. After the deadline passed with no action taken, on February 13, 2025, the Doxbin database was leaked as a lesson for their irresponsibility. This is the message Graveyard received afterwards:`;
      const code = `https://186.2.171.20/login_up.php\nhttps://186.2.171.20/cp/javascript/main.js\nhttps://186.2.171.20/cp/javascript/vendors.js`;
      storyWrap.innerHTML = `<p>${narrative}</p><pre><code>${code}</code></pre>`;
    }
  }

  if (citadelBtn && citadelPanel) {
    const setPanelC = (show) => {
      if (show) {
        citadelPanel.classList.add('show');
        citadelPanel.setAttribute('aria-hidden', 'false');
        citadelBtn.setAttribute('aria-expanded', 'true');
      } else {
        citadelPanel.classList.remove('show');
        citadelPanel.setAttribute('aria-hidden', 'true');
        citadelBtn.setAttribute('aria-expanded', 'false');
      }
    };

    let openC = false;
    const toggleC = () => {
      openC = !openC; setPanelC(openC);
      if (openC && toodaPanel) {
        toodaPanel.classList.remove('show');
        toodaPanel.setAttribute('aria-hidden', 'true');
        if (toodaBtn) toodaBtn.setAttribute('aria-expanded', 'false');
      }
    };
    citadelBtn.addEventListener('click', (e) => { triggerBtnFX(citadelBtn, e); toggleC(); });
    citadelBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerBtnFX(citadelBtn);
        toggleC();
      }
    });
    document.addEventListener('click', (e) => {
      const po = document.getElementById('proof-overlay');
      if (po && po.classList.contains('show')) return;
      if (!openC) return;
      const t = e.target;
      if (!citadelPanel.contains(t) && t !== citadelBtn) { openC = false; setPanelC(false); }
    });

    const header = citadelPanel.querySelector('.team-list h2');
    if (header) header.textContent = 'Citadel';
    const ul = citadelPanel.querySelector('.team-list .nick-list');
    if (ul) {
      ul.innerHTML = '';
      const items = ['status: ?'];
      items.forEach(txt => { const li = document.createElement('li'); li.textContent = txt; ul.appendChild(li); });
    }
    const storyWrap = citadelPanel.querySelector('.story');
    if (storyWrap) {
      const narrative = `February 2025 — I find an exploit in Discord VoIP’s RTC data and, using it, can down Discord VC offline — packet loss spikes to ~90%.
In mid-April I launch an attack on Telegram: 2/4 DCs plus web.telegram.org go down, and in under an hour Downdetector received about ~10k reports.`;
      storyWrap.innerHTML = `<p>${narrative}</p>`;
    }
  }

  if (citadelPanel) {
    const sW = citadelPanel.querySelector('.story');
    if (sW) {
      const narrativeParts = [
        'February 2025 — I find an exploit in Discord VoIP’s RTC data and, using it, can down Discord VC offline — packet loss spikes to ~90%.',
        'In mid-April I launch an attack on Telegram: 2/4 DCs plus web.telegram.org go down. Peak push reached 3.1 Tbps. <a href=\"#\" class=\"proof-link proof-highlight\" data-src=\"files/proof.png\">Avg user reports ~10k. Down status held ~1h. Status: ?</a>',
        'April 17 — Telegram users began reporting widespread service disruptions. The first issues appeared around 19:30 MSK, and reports on Downradar and Downdetector started rapidly increasing. Users noted messages weren’t being delivered; for some, chats and media failed to load.'
      ];
      sW.innerHTML = narrativeParts.map(p => `<p>${p}</p>`).join('');
    }
  }

  const proofOverlay = document.getElementById('proof-overlay');
  const proofImg = document.getElementById('proof-img');
  const openProof = (src) => {
    if (!proofOverlay || !proofImg) return;
    proofImg.src = src;
    proofOverlay.classList.add('show');
    proofOverlay.setAttribute('aria-hidden', 'false');
  };
  const closeProof = () => {
    if (!proofOverlay || !proofImg) return;
    proofOverlay.classList.remove('show');
    proofOverlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => { proofImg.src = ''; }, 220);
  };
  if (proofOverlay) {
    proofOverlay.addEventListener('click', closeProof);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProof(); });
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.proof-link');
    if (a) {
      e.preventDefault();
      const src = a.getAttribute('data-src') || a.getAttribute('href');
      if (src) openProof(src);
    }
  });
});
