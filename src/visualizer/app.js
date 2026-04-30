// ─── State ──────────────────────────────────────────
let ALL_MEMORIES = [];
let SESSION_DATA = { sessionId: '', events: [] };
let STATUS_DATA = {};

let activeKnowledgeCat = 'all';
let accumulationChart = null;
let scopeChart = null;

// ─── Helpers ────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const s = (Date.now() - dt.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s/60) + 'm ago';
  if (s < 86400) return Math.round(s/3600) + 'h ago';
  return dt.toLocaleDateString();
}

// ─── View Switching ─────────────────────────────────
function switchView(viewId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${viewId}"]`)?.classList.add('active');
  
  document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');
}

// ─── Data Loading ───────────────────────────────────
async function loadAllData() {
  const btn = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshIcon');
  const loader = document.getElementById('loading');
  
  btn.disabled = true;
  icon.classList.add('spin');
  loader.classList.remove('hidden');

  try {
    const [memRes, sesRes, statusRes, stratRes] = await Promise.all([
      fetch('/api/memories').then(r => r.json()).catch(() => ({ memories: [] })),
      fetch('/api/session').then(r => r.json()).catch(() => ({ sessionId: '', events: [] })),
      fetch('/api/status').then(r => r.json()).catch(() => ({})),
      fetch('/api/strategies').then(r => r.json()).catch(() => ({ strategies: [] })),
    ]);

    // Merge and dedup
    const seen = new Set();
    ALL_MEMORIES = [];
    const rawAll = [...(memRes.memories || []), ...(stratRes.strategies || [])];
    for (const m of rawAll) {
      if (!seen.has(m.memoryId)) {
        seen.add(m.memoryId);
        
        // Enhance classification for UI
        if (m.scope === 'strategy' || m.source === 'auto-extracted') {
          m.uiCat = m.strategyType || 'semantic'; 
        } else {
          m.uiCat = 'manual';
        }
        
        ALL_MEMORIES.push(m);
      }
    }
    
    SESSION_DATA = sesRes;
    STATUS_DATA = statusRes;

    renderAnalytics();
    renderKnowledgeBase();
    renderExperienceLog();
    renderRawTable();
    renderSystem();

  } catch (err) {
    console.error('Failed to load data:', err);
  } finally {
    btn.disabled = false;
    icon.classList.remove('spin');
    loader.classList.add('hidden');
  }
}

// ─── Analytics View ─────────────────────────────────
function renderAnalytics() {
  const semantic = ALL_MEMORIES.filter(m => m.uiCat === 'semantic').length;
  const prefs = ALL_MEMORIES.filter(m => m.uiCat === 'preference').length;
  const orgShared = ALL_MEMORIES.filter(m => m.scope === 'org').length;
  
  // Calculate this week's growth (simplified)
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentCount = ALL_MEMORIES.filter(m => new Date(m.createdAt).getTime() > oneWeekAgo).length;

  document.getElementById('kpi-growth').textContent = '+' + recentCount;
  document.getElementById('kpi-semantic').textContent = semantic;
  document.getElementById('kpi-prefs').textContent = prefs;
  document.getElementById('kpi-shared').textContent = orgShared;

  // Render Charts
  renderAccumulationChart();
  renderScopeDonut();
}

function renderAccumulationChart() {
  const dayMap = {};
  ALL_MEMORIES.forEach(m => {
    if (!m.createdAt) return;
    const d = new Date(m.createdAt).toISOString().slice(0, 10);
    dayMap[d] = (dayMap[d] || 0) + 1;
  });
  
  const days = Object.keys(dayMap).sort();
  let cumulative = 0;
  const data = days.map(d => {
    cumulative += dayMap[d];
    return cumulative;
  });

  const ctx = document.getElementById('accumulationChart');
  if (accumulationChart) accumulationChart.destroy();
  accumulationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days.map(d => d.slice(5)), // MM-DD
      datasets: [{
        label: 'Total Knowledge Base Size',
        data: data,
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88, 166, 255, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#30363d' }, ticks: { color: '#8b949e' } },
        y: { grid: { color: '#30363d' }, ticks: { color: '#8b949e' }, beginAtZero: true }
      }
    }
  });
}

function renderScopeDonut() {
  const counts = { user: 0, project: 0, org: 0, auto: 0 };
  ALL_MEMORIES.forEach(m => {
    if (m.source === 'auto-extracted') counts.auto++;
    else counts[m.scope] = (counts[m.scope] || 0) + 1;
  });

  const ctx = document.getElementById('scopeChart');
  if (scopeChart) scopeChart.destroy();
  scopeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Auto (Semantic)', 'User (Private)', 'Project', 'Org (Shared)'],
      datasets: [{
        data: [counts.auto, counts.user, counts.project, counts.org],
        backgroundColor: ['#8957e5', '#2f81f7', '#3fb950', '#d29922'],
        borderWidth: 0
      }]
    },
    options: { cutout: '70%', plugins: { legend: { position: 'right', labels: { color: '#c9d1d9' } } } }
  });
}

// ─── Knowledge Base (Semantic) View ─────────────────
function renderKnowledgeBase() {
  document.getElementById('cat-all').textContent = ALL_MEMORIES.length;
  document.getElementById('cat-semantic').textContent = ALL_MEMORIES.filter(m => m.uiCat === 'semantic').length;
  document.getElementById('cat-prefs').textContent = ALL_MEMORIES.filter(m => m.uiCat === 'preference').length;
  document.getElementById('cat-summary').textContent = ALL_MEMORIES.filter(m => m.uiCat === 'summary').length;
  document.getElementById('cat-manual').textContent = ALL_MEMORIES.filter(m => m.uiCat === 'manual').length;
  
  filterKnowledgeContent();
}

function filterKnowledge(cat, el) {
  activeKnowledgeCat = cat;
  document.querySelectorAll('.cat-item').forEach(li => li.classList.remove('active'));
  el.classList.add('active');
  filterKnowledgeContent();
}

function filterKnowledgeContent() {
  const q = document.getElementById('knowledgeSearch').value.toLowerCase();
  const grid = document.getElementById('knowledge-grid');
  
  let filtered = ALL_MEMORIES;
  if (activeKnowledgeCat !== 'all') {
    filtered = filtered.filter(m => m.uiCat === activeKnowledgeCat);
  }
  
  if (q) {
    filtered = filtered.filter(m => (m.content||'').toLowerCase().includes(q));
  }
  
  grid.innerHTML = filtered.map(m => {
    const typeLabel = m.uiCat === 'semantic' ? '🧠 Core Fact' : 
                      m.uiCat === 'preference' ? '👤 Preference' : 
                      m.uiCat === 'summary' ? '📝 Summary' : '✍️ Manual';
    
    return `
      <div class="k-card type-${m.uiCat}">
        <div class="k-header">
          <span class="k-badge">${typeLabel}</span>
          <span class="k-badge" style="background:transparent; color:#8b949e">${m.scope}</span>
        </div>
        <div class="k-content">${esc(m.content)}</div>
        <div class="k-footer">
          <span>${esc(m.memoryId).slice(0, 12)}...</span>
          <span>${timeAgo(m.createdAt)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Experience Log (Episodic) View ─────────────────
function renderExperienceLog() {
  const events = SESSION_DATA.events || [];
  document.getElementById('gauge-evt-val').textContent = events.length;
  document.getElementById('gauge-events').style.width = Math.min(100, (events.length / 50) * 100) + '%';
  
  const container = document.getElementById('timeline-feed');
  
  if (events.length === 0) {
    container.innerHTML = `<div style="color:#8b949e; padding: 20px;">No session events recorded yet.</div>`;
    return;
  }
  
  // Sort oldest first for a timeline view
  const sorted = [...events].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  container.innerHTML = sorted.map((evt, idx) => {
    const msgs = (evt.messages || []).map(m => {
      const cls = m.role.toLowerCase() === 'user' ? 'msg-user' : 'msg-assistant';
      return `<div class="msg-bubble ${cls}"><strong>${esc(m.role)}:</strong><br/>${esc(m.content)}</div>`;
    }).join('');
    
    // Simulate extraction linkage (visually hint that events lead to knowledge)
    // In a real advanced setup, you'd match trace IDs.
    let extractionHtml = '';
    if (idx === sorted.length - 1 && ALL_MEMORIES.length > 0) {
       extractionHtml = `
         <div class="extraction-link">
           <span>🤖</span>
           <span><strong>Distillation Triggered:</strong> AgentCore strategies evaluated this context and extracted facts.</span>
         </div>`;
    }

    return `
      <div class="evt-block">
        <div class="evt-time">${new Date(evt.timestamp).toLocaleString()} | ID: ${esc(evt.eventId)}</div>
        <div style="display:flex; flex-direction:column;">
          ${msgs}
        </div>
        ${extractionHtml}
      </div>
    `;
  }).join('');
}

// ─── Raw Data Explorer ──────────────────────────────
function renderRawTable() {
  const q = document.getElementById('rawSearch').value.toLowerCase();
  const scope = document.getElementById('rawScopeFilter').value;
  
  let filtered = ALL_MEMORIES;
  if (scope !== 'all') filtered = filtered.filter(m => m.scope === scope || (scope === 'strategy' && m.source === 'auto-extracted'));
  if (q) filtered = filtered.filter(m => (m.content||'').toLowerCase().includes(q) || m.memoryId.toLowerCase().includes(q));
  
  const tbody = document.getElementById('raw-table-body');
  tbody.innerHTML = filtered.map(m => `
    <tr>
      <td title="${esc(m.memoryId)}">${esc(m.memoryId).slice(0, 8)}...</td>
      <td>${esc(m.scope)}</td>
      <td class="td-snippet" title="${esc(m.content)}">${esc(m.content)}</td>
      <td>${esc(m.source)}</td>
      <td>${new Date(m.createdAt).toLocaleDateString()}</td>
    </tr>
  `).join('');
}

// ─── System Status View ─────────────────────────────
function renderSystem() {
  const s = STATUS_DATA;
  const grid = document.getElementById('system-grid');
  
  if (!s.memoryId) return;

  grid.innerHTML = `
    <div class="sys-card">
      <h3>AWS Resources</h3>
      <div class="sys-row"><span>Memory ARN</span> <span class="sys-val" title="${s.memoryId}">${s.memoryId.split('/').pop()}</span></div>
      <div class="sys-row"><span>Actor ID</span> <span class="sys-val">${s.actorId}</span></div>
      <div class="sys-row"><span>Org ID</span> <span class="sys-val">${s.orgId}</span></div>
    </div>
    <div class="sys-card">
      <h3>Active Session</h3>
      <div class="sys-row"><span>Session ID</span> <span class="sys-val">${s.session?.sessionId}</span></div>
      <div class="sys-row"><span>Logged Events</span> <span class="sys-val">${s.session?.eventCount}</span></div>
    </div>
    <div class="sys-card">
      <h3>Namespaces Configured</h3>
      <div class="sys-row"><span>User Path</span> <span class="sys-val" style="font-size:11px">${s.namespaces?.user}</span></div>
      <div class="sys-row"><span>Org Path</span> <span class="sys-val" style="font-size:11px">${s.namespaces?.org}</span></div>
      <div class="sys-row"><span>Strategy Base</span> <span class="sys-val" style="font-size:11px">${s.namespaces?.strategyPath}</span></div>
    </div>
  `;
}

// ─── Boot ───────────────────────────────────────────
loadAllData();
