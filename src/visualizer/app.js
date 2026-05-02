// ─── State ──────────────────────────────────────────
let ALL_MEMORIES = [];
let SESSION_EVENTS = [];
let STATUS = {};
let LIVE_INTERVAL = null;
let IS_LIVE = true;

const searchState = { scope: 'all', type: 'all', query: '' };

// ─── Helpers ────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const s = (Date.now() - dt.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return dt.toLocaleDateString();
}

function scoreClass(score) {
  if (score >= 0.7) return 'score-high';
  if (score >= 0.4) return 'score-mid';
  return 'score-low';
}

function typeClass(type) {
  const map = {
    style: 'tag-type-style',
    architecture: 'tag-type-architecture',
    bugfix: 'tag-type-bugfix',
    api_pattern: 'tag-type-api_pattern',
    preference: 'tag-type-preference',
    general: 'tag-type-general',
  };
  return map[type] || 'tag-type-general';
}

function scopeClass(scope) {
  const map = {
    user: 'tag-scope-user',
    project: 'tag-scope-project',
    org: 'tag-scope-org',
    strategy: 'tag-scope-strategy',
  };
  return map[scope] || 'tag-scope-user';
}

// ─── Tab Switching ──────────────────────────────────
function switchTab(viewId) {
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
  document.querySelector(`.tab[data-view="${viewId}"]`)?.classList.add('active');

  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');

  if (viewId === 'explore' && searchState.query) {
    doSearch();
  }
}

// ─── Live Toggle ────────────────────────────────────
function toggleLive() {
  IS_LIVE = !IS_LIVE;
  const indicator = document.getElementById('liveToggle');
  const text = document.getElementById('liveText');

  if (IS_LIVE) {
    indicator.classList.remove('off');
    text.textContent = 'Live';
    startLiveRefresh();
  } else {
    indicator.classList.add('off');
    text.textContent = 'Paused';
    stopLiveRefresh();
  }
}

function startLiveRefresh() {
  if (LIVE_INTERVAL) clearInterval(LIVE_INTERVAL);
  LIVE_INTERVAL = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadAllData(true);
    }
  }, 5000);
}

function stopLiveRefresh() {
  if (LIVE_INTERVAL) {
    clearInterval(LIVE_INTERVAL);
    LIVE_INTERVAL = null;
  }
}

// ─── Data Loading ───────────────────────────────────
async function loadAllData(silent = false) {
  if (!silent) {
    // Show loading only on initial load
  }

  try {
    const [memRes, sesRes, statusRes, stratRes] = await Promise.all([
      fetch('/api/memories').then((r) => r.json()).catch(() => ({ memories: [] })),
      fetch('/api/session').then((r) => r.json()).catch(() => ({ events: [] })),
      fetch('/api/status').then((r) => r.json()).catch(() => ({})),
      fetch('/api/strategies').then((r) => r.json()).catch(() => ({ strategies: [] })),
    ]);

    const seen = new Set();
    ALL_MEMORIES = [];
    const rawAll = [...(memRes.memories || []), ...(stratRes.strategies || [])];
    for (const m of rawAll) {
      if (!seen.has(m.memoryId)) {
        seen.add(m.memoryId);
        if (m.scope === 'strategy' || m.source === 'auto-extracted') {
          m.uiCat = m.strategyType || 'semantic';
        } else {
          m.uiCat = 'manual';
        }
        ALL_MEMORIES.push(m);
      }
    }

    SESSION_EVENTS = sesRes.events || [];
    STATUS = statusRes;

    renderNow();
    renderProfile();
    updateBadge();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// ─── Now View ───────────────────────────────────────
function renderNow() {
  // Stats
  const autoCount = ALL_MEMORIES.filter((m) => m.source === 'auto-extracted').length;
  const manualCount = ALL_MEMORIES.length - autoCount;
  const topScore = ALL_MEMORIES.length
    ? Math.max(...ALL_MEMORIES.filter((m) => typeof m.score === 'number').map((m) => m.score || 0))
    : 0;

  document.getElementById('stat-total').textContent = ALL_MEMORIES.length;
  document.getElementById('stat-auto').textContent = autoCount;
  document.getElementById('stat-session').textContent = SESSION_EVENTS.length;
  document.getElementById('stat-session-meta').textContent = `Events in ${STATUS.session?.sessionId?.slice(0, 20) || 'current session'}...`;
  document.getElementById('stat-topscore').textContent = topScore ? topScore.toFixed(2) : '-';

  // Recently learned (top 8 by recency)
  const recent = [...ALL_MEMORIES]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 8);

  const recentEl = document.getElementById('now-recent');
  if (recent.length === 0) {
    recentEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">&#129504;</div>
        <h3>No memories yet</h3>
        <p>Start using your AI coding agent. Memories will appear here as they are saved.</p>
      </div>`;
  } else {
    recentEl.innerHTML = recent.map((m) => renderMemoryCard(m)).join('');
  }

  // Live feed
  const feedEl = document.getElementById('now-feed');
  const feedItems = [];

  // Add session events
  SESSION_EVENTS.slice(-5).reverse().forEach((evt) => {
    const msg = evt.messages?.[0]?.content?.slice(0, 80) || 'Conversation event';
    feedItems.push({
      icon: '&#128172;',
      bg: 'rgba(88,166,255,0.12)',
      text: msg + (msg.length >= 80 ? '...' : ''),
      meta: `Session event · ${timeAgo(evt.timestamp)}`,
    });
  });

  // Add recent memories
  ALL_MEMORIES.slice(0, 5).forEach((m) => {
    feedItems.push({
      icon: m.source === 'auto-extracted' ? '&#9889;' : '&#128221;',
      bg: m.source === 'auto-extracted' ? 'rgba(163,113,247,0.12)' : 'rgba(88,166,255,0.12)',
      text: (m.content || '').slice(0, 80) + ((m.content || '').length > 80 ? '...' : ''),
      meta: `${m.source === 'auto-extracted' ? 'Auto-extracted' : 'Manual'} · ${m.scope} · ${timeAgo(m.createdAt)}`,
    });
  });

  if (feedItems.length === 0) {
    feedEl.innerHTML = `
      <div class="empty-state" style="padding: 30px;">
        <p>No activity yet. Save a conversation to see the feed.</p>
      </div>`;
  } else {
    feedEl.innerHTML = feedItems
      .map(
        (item) => `
      <div class="feed-item">
        <div class="icon" style="background: ${item.bg}">${item.icon}</div>
        <div class="body">
          <div class="text">${esc(item.text)}</div>
          <div class="meta">${esc(item.meta)}</div>
        </div>
      </div>`
      )
      .join('');
  }
}

// ─── Explore View ───────────────────────────────────
async function doSearch() {
  const query = document.getElementById('explore-search').value.trim();
  if (!query) return;

  searchState.query = query;
  const resultsEl = document.getElementById('explore-results');
  resultsEl.innerHTML = '<div class="loading"><div class="spinner"></div>Searching...</div>';

  try {
    const params = new URLSearchParams();
    params.set('q', query);
    if (searchState.scope !== 'all') params.set('scope', searchState.scope);
    if (searchState.type !== 'all') params.set('type', searchState.type);

    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      resultsEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">&#128270;</div>
          <h3>No results</h3>
          <p>Try a different query or adjust filters. The AI might not have learned about this topic yet.</p>
        </div>`;
      return;
    }

    resultsEl.innerHTML = results.map((m) => renderMemoryCard(m, true)).join('');
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-state"><h3>Search failed</h3><p>${esc(err.message)}</p></div>`;
  }
}

function setFilter(category, value) {
  if (category === 'scope') searchState.scope = value;
  if (category === 'type') searchState.type = value;

  document.querySelectorAll(`.filter-pill[data-filter="${category}"]`).forEach((el) => {
    el.classList.toggle('active', el.dataset.value === value);
  });

  if (searchState.query) doSearch();
}

// ─── Profile View ───────────────────────────────────
function renderProfile() {
  // Preferences
  const preferences = ALL_MEMORIES.filter((m) => {
    const mt = m.memoryType;
    return mt === 'style' || mt === 'preference';
  });

  const prefEl = document.getElementById('profile-preferences');
  if (preferences.length === 0) {
    prefEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">No preferences learned yet. The AI will extract your coding style over time.</p>`;
  } else {
    prefEl.innerHTML = preferences
      .slice(0, 8)
      .map(
        (m) => `
      <div class="pref-item">
        <div class="bullet"></div>
        <div>
          <div class="text">${esc((m.content || '').slice(0, 120))}${(m.content || '').length > 120 ? '...' : ''}</div>
          <div class="source">${m.memoryType} · ${m.scope} · ${timeAgo(m.createdAt)}</div>
        </div>
      </div>`
      )
      .join('');
  }

  // Languages
  const langCounts = {};
  ALL_MEMORIES.forEach((m) => {
    if (m.language) {
      langCounts[m.language] = (langCounts[m.language] || 0) + 1;
    }
  });

  const langEl = document.getElementById('profile-languages');
  const langs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
  if (langs.length === 0) {
    langEl.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">No languages detected yet.</span>`;
  } else {
    langEl.innerHTML = langs
      .map(
        ([lang, count]) => `
      <div class="lang-tag">
        ${esc(lang)}
        <span class="count">${count}</span>
      </div>`
      )
      .join('');
  }

  // Stats
  const statsEl = document.getElementById('profile-stats');
  const projectCounts = {};
  ALL_MEMORIES.forEach((m) => {
    if (m.projectName) {
      projectCounts[m.projectName] = (projectCounts[m.projectName] || 0) + 1;
    }
  });

  statsEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
        <span style="color: var(--text-muted);">Memories saved</span>
        <span style="font-weight: 600;">${ALL_MEMORIES.length}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
        <span style="color: var(--text-muted);">Auto-extracted</span>
        <span style="font-weight: 600;">${ALL_MEMORIES.filter((m) => m.source === 'auto-extracted').length}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
        <span style="color: var(--text-muted);">Manual saves</span>
        <span style="font-weight: 600;">${ALL_MEMORIES.filter((m) => m.source !== 'auto-extracted').length}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 8px 0;">
        <span style="color: var(--text-muted);">Unique projects</span>
        <span style="font-weight: 600;">${Object.keys(projectCounts).length}</span>
      </div>
    </div>
  `;

  // Projects
  const projEl = document.getElementById('profile-projects');
  const projects = Object.entries(projectCounts).sort((a, b) => b[1] - a[1]);
  if (projects.length === 0) {
    projEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">No project memories yet.</p>`;
  } else {
    projEl.innerHTML = projects
      .map(
        ([proj, count]) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border);">
        <span style="font-weight: 500;">${esc(proj)}</span>
        <span style="font-size: 12px; color: var(--text-muted);">${count} memories</span>
      </div>`
      )
      .join('');
  }
}

// ─── Memory Card Renderer ───────────────────────────
function renderMemoryCard(m, showScore = false) {
  const typeTag = m.memoryType
    ? `<span class="tag ${typeClass(m.memoryType)}">${m.memoryType.replace('_', ' ')}</span>`
    : '';
  const scopeTag = `<span class="tag ${scopeClass(m.scope)}">${m.scope}</span>`;
  const scoreTag =
    showScore && typeof m.score === 'number'
      ? `<span class="score ${scoreClass(m.score)}">${m.score.toFixed(2)}</span>`
      : '';

  return `
    <div class="memory-card">
      <div class="card-header">
        <div class="tags">${typeTag}${scopeTag}</div>
        ${scoreTag}
      </div>
      <div class="content-text">${esc(m.content || '')}</div>
      <div class="card-footer">
        <span>${esc(m.memoryId).slice(0, 8)}...</span>
        <span>${timeAgo(m.createdAt)}</span>
      </div>
    </div>
  `;
}

// ─── Badge ──────────────────────────────────────────
function updateBadge() {
  const badge = document.getElementById('badge-now');
  if (badge) badge.textContent = ALL_MEMORIES.length;
}

// ─── Boot ───────────────────────────────────────────
loadAllData();
startLiveRefresh();
