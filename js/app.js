// ══════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════
const API_BASE = 'https://api2.ghin.com/api/v1';
let AUTH_TOKEN        = null;
let GOLFER_ID         = null;
let CURRENT_USER_NAME   = 'Me';
let CURRENT_USER_HCP_RAW = '0';
let CURRENT_USER_LO_HCP  = '—';
let allMembers = [];
let memberScoresCache = {}; // id -> scores array
let memberScoresFetched = false;
let trendChartInstance = null;
let diffChartInstance  = null;

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════
async function doLogin() {
  const username   = document.getElementById('username').value.trim();
  const password   = document.getElementById('password').value;
  const rememberMe = document.getElementById('remember-me').checked;
  const btn        = document.getElementById('login-btn');
  const errEl      = document.getElementById('login-error');

  if (!username || !password) {
    showError('Please enter your GHIN username and password.'); return;
  }

  // Save or clear username based on remember me
  if (rememberMe) {
    localStorage.setItem('ghin_username', username);
    localStorage.setItem('ghin_remember', 'true');
  } else {
    localStorage.removeItem('ghin_username');
    localStorage.removeItem('ghin_remember');
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  errEl.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/golfer_login.json`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        user: { email_or_ghin: username, password, remember_me: 'true', source: 'GHINcom' },
        token: '4XxmdKDLAnV5vdfV97PNGNsp7z2Z1z3Pax84WMf26NUCitoArI8aWd24m/IUApBpmXR/zCHAwofHDao1EOUBp7tvGnJAUiv9AcFmVnNuaDWUS6I1Sha7nQqcnM0Pz7qEc9ZwHUvimGj/jvI02vNOFAK3lw8qDjsrW2jmbH2f8uE43qGqkH5WDxL68CzCDpvKGNvfOKny+4hhLDpg7xMBRqjAu0FgyEIzppiik12c+kYOO8ig5c44FC95x5JHXz+QjhEuayh6QhhxXwAEvmitOirsPpyCJiT2hYx2VEgpoxNrn3gEVDoEy8fy2MjC+XcZy9DdAorWo7MjT8M+rSKG2d78Hbsv4W3ic2fgIuGzRFZVKNAkB85/0tUjjqdZJT1/5wtkjx2ail/S0KeGgrZeHWaZvQNWgWwKL75Vw2o055HjoqWIap4T9wacwW4mtIhaAA3M2kVTMzmgqTXbjMAdfZuBwJWByeCnAt6/Ij4WpUT4cooyLWhV3sflDd4xvsvfeE8/6cTm6E0gxwXg/aUDhOPTbF5x6hslNMleSmDsdvUlmo3yAk4x/I7BeqwWwYN3bTei0ZsMhRHVTx4I1SJR9GV2Ud1B3fwkvJ+19Ds5oA+8GBDgXdTV7ldTV7i/9wHMTfsLmMSp8HBq+NxCenFKuxIJ+3LDSifdzqkL7YFYGz4='
      })
    });

    const data = await res.json();

    if (!res.ok || !data.golfer_user) {
      throw new Error(data.message || data.error || 'Login failed. Check your credentials.');
    }

    const gu = data.golfer_user;
    AUTH_TOKEN = gu.golfer_user_token;

    // Extract GHIN number from login response — try every known field name
    GOLFER_ID = gu.ghin_number
      || gu.golfer_id
      || gu.id
      || gu.ghinNumber
      || (gu.golfer && gu.golfer.ghin_number)
      || (gu.golfer && gu.golfer.id)
      || null;

    // If still not found, fetch it from the golfer search using email
    if (!GOLFER_ID && gu.email) {
      try {
        const r = await fetch(
          `${API_BASE}/golfers/search.json?email=${encodeURIComponent(gu.email)}&per_page=5&page=1&source=GHINcom`,
          { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${AUTH_TOKEN}` } }
        );
        const d = await r.json();
        GOLFER_ID = d.golfers && d.golfers[0] && (d.golfers[0].ghin || d.golfers[0].id);
      } catch(e) { console.warn('Could not fetch GHIN number from email lookup', e); }
    }

    console.log('Logged in — GOLFER_ID:', GOLFER_ID, '| Raw gu keys:', Object.keys(gu));

    if (!GOLFER_ID) {
      throw new Error('Could not determine your GHIN number from the login response. Please contact support.');
    }

    const name = `${gu.first_name || ''} ${gu.last_name || ''}`.trim();
    CURRENT_USER_NAME = name || username;
    document.getElementById('user-badge').textContent = CURRENT_USER_NAME;

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('app').style.flexDirection = 'column';

    // Fetch golfer profile to get home club and association IDs dynamically
    try {
      const profileRes = await fetch(
        `${API_BASE}/golfers/search.json?golfer_id=${GOLFER_ID}&per_page=25&page=1&source=GHINcom`,
        { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${AUTH_TOKEN}` } }
      );
      const profileData = await profileRes.json();
      const g = profileData.golfers && profileData.golfers[0];
      if (g) {
        CLUB_ID        = String(g.club_id        || CLUB_ID);
        ASSOCIATION_ID = String(g.association_id || ASSOCIATION_ID);
        CURRENT_USER_HCP_RAW = g.hi_display ?? g.handicap_index ?? '0';
        CURRENT_USER_LO_HCP  = fmtHcp(g.low_hi_display ?? g.low_hi_value) || '—';
        // Update club name in the subtab button
        const clubBtn = document.getElementById('subtab-club');
        if (clubBtn) clubBtn.textContent = g.club_name || 'My Club';
      }
    } catch(e) { console.warn('Could not fetch golfer profile for club IDs', e); }

    loadMyScores();
    loadMembers();

  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function showError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function doLogout() {
  AUTH_TOKEN = null; GOLFER_ID = null; CURRENT_USER_NAME = 'Me'; CURRENT_USER_HCP_RAW = '0'; CURRENT_USER_LO_HCP = '—'; allMembers = []; memberScoresCache = {}; memberScoresFetched = false;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  document.getElementById('login-error').style.display = 'none';
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
// Display handicap index with correct + prefix for plus handicaps
// GHIN returns plus handicaps as negative numbers (e.g. -2.7) or as strings (e.g. "+2.7")
function fmtHcp(val) {
  if (val == null || val === '' || val === '—') return '—';
  const s = String(val).trim();
  // Already formatted with + (e.g. "+2.7") — return as-is
  if (s.startsWith('+')) return s;
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  // Negative numeric value = plus handicap
  return n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1);
}

function authHeaders() {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'Authorization': `Bearer ${AUTH_TOKEN}`
  };
}

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return isNaN(d) ? str : d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function diffBadge(diff) {
  if (diff == null) return '<span class="score-diff even">—</span>';
  const n = parseFloat(diff);
  const cls = n > 0 ? 'over' : n < 0 ? 'under' : 'even';
  return `<span class="score-diff ${cls}">${n.toFixed(1)}</span>`;
}

function trendArrow(trend) {
  if (trend == null || trend === 0) return '<span style="color:var(--muted)">→ 0.0</span>';
  return trend > 0
    ? `<span class="trend-up">↑ +${parseFloat(trend).toFixed(1)}</span>`
    : `<span class="trend-down">↓ ${parseFloat(trend).toFixed(1)}</span>`;
}

// ══════════════════════════════════════════
//  MY SCORES
// ══════════════════════════════════════════
async function loadMyScores() {
  try {
    // Fetch golfer profile with required per_page and page params
    const golferRes = await fetch(
      `${API_BASE}/golfers/search.json?golfer_id=${GOLFER_ID}&per_page=25&page=1&source=GHINcom`,
      { headers: authHeaders() }
    );
    const golferData = await golferRes.json();
    const golfer = (golferData.golfers && golferData.golfers[0]) || {};

    // Paginate through ALL scores
    let allScores = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${API_BASE}/golfers/${GOLFER_ID}/scores.json?per_page=20&page=${page}&source=GHINcom`,
        { headers: authHeaders() }
      );
      const data = await res.json();
      const revScores    = (data.revision_scores && data.revision_scores.scores) || [];
      const recentScores = (data.recent_scores   && data.recent_scores.scores)   || [];
      const batch = [...revScores, ...recentScores];
      if (batch.length === 0) break;
      allScores = allScores.concat(batch);
      if (batch.length < 20) break;
      page++;
      if (page > 50) break; // safety cap
    }

    // Deduplicate and sort newest first
    const seen = new Set();
    const scores = allScores.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id); return true;
    }).sort((a,b) => new Date(b.played_at) - new Date(a.played_at));

    renderStats(golfer, scores);
    renderScoresTable(scores);
    renderTrend(scores);
  } catch(e) {
    console.error('loadMyScores error:', e);
    document.getElementById('scores-tbody').innerHTML =
      `<tr><td colspan="7" class="empty-state">⚠ Could not load scores: ${e.message}</td></tr>`;
  }
}

function renderStats(golfer, scores) {
  const hcp    = fmtHcp(golfer.hi_value ?? golfer.hi_display ?? golfer.handicap_index);
  const lo     = golfer.low_hi_display || '—';
  const loDate = golfer.low_hi_date   ? fmtDate(golfer.low_hi_date) : '';
  const revDate = golfer.rev_date     ? fmtDate(golfer.rev_date) : '';
  const count  = scores.length;
  const recent = scores.slice(0,5);
  const recentDiffs = recent.map(s => parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential)).filter(n => !isNaN(n));
  const avg = recentDiffs.length
    ? (recentDiffs.reduce((a,b)=>a+b,0)/recentDiffs.length).toFixed(2)
    : '—';

  document.getElementById('my-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Handicap Index</div>
      <div class="stat-value">${hcp}</div>
      <div class="stat-sub">Revised ${revDate}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Low Index</div>
      <div class="stat-value">${lo}</div>
      <div class="stat-sub">${loDate}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Rounds Recorded</div>
      <div class="stat-value">${count}</div>
      <div class="stat-sub">All time</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Differential (last 5)</div>
      <div class="stat-value">${avg}</div>
      <div class="stat-sub">Lower is better</div>
    </div>
  `;

  // mirror to trend tab
  document.getElementById('trend-stats').innerHTML =
    document.getElementById('my-stats').innerHTML;
}

function renderScoresTable(scores) {
  const tbody = document.getElementById('scores-tbody');
  document.getElementById('score-count').textContent = `${scores.length} rounds`;

  if (!scores.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No scores found.</td></tr>';
    return;
  }

  tbody.innerHTML = scores.map(s => {
    const courseName = s.facility_name || s.course_name || '—';
    const tees       = s.tee_name || s.course_rating_name || '—';
    const rating     = s.course_rating ? parseFloat(s.course_rating).toFixed(1) : '—';
    const slope      = s.slope_rating || '—';
    const score      = s.adjusted_gross_score || s.gross_score || '—';
    const diff       = s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential ?? null;
    const type       = s.score_type || s.status || '—';
    const date       = fmtDate(s.played_at);

    const diffVsPar = (score !== '—' && s.par)
      ? diffBadge(score - s.par)
      : diffBadge(null);

    return `<tr>
      <td>${date}</td>
      <td>${courseName}</td>
      <td>${tees}</td>
      <td>${rating} / ${slope}</td>
      <td><strong>${score}</strong></td>
      <td>${diff != null ? diffBadge(diff) : diffVsPar}</td>
      <td style="font-size:0.7rem;color:var(--muted)">${type}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════
//  TREND CHARTS
// ══════════════════════════════════════════
function renderTrend(scores) {
  if (!scores.length) return;

  // Sort oldest to newest for left-to-right chart display
  const sorted = [...scores].sort((a,b) => new Date(a.played_at) - new Date(b.played_at));

  // Use adjusted_scaled_up_differential throughout — handles 9-hole and partial rounds correctly
  const validScores = sorted.filter(s => !isNaN(parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential)));
  const diffs  = validScores.map(s => parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential));
  const labels = validScores.map(s => fmtDate(s.played_at));

  // Rolling 5-round average differential line (smoothed trend)
  const rollingAvg = diffs.map((_, i) => {
    const window = diffs.slice(Math.max(0, i-4), i+1);
    return +(window.reduce((a,b)=>a+b,0)/window.length).toFixed(2);
  });

  const green = '#2d6a4f';
  const gold  = '#c9a84c';

  if (trendChartInstance) trendChartInstance.destroy();
  if (diffChartInstance)  diffChartInstance.destroy();

  // Differential trend line + rolling average
  const ctx1 = document.getElementById('trend-chart').getContext('2d');
  trendChartInstance = new Chart(ctx1, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Differential',
          data: diffs,
          borderColor: green,
          backgroundColor: 'rgba(45,106,79,0.06)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: green,
          fill: true,
          tension: 0.2,
        },
        {
          label: '5-Round Avg',
          data: rollingAvg,
          borderColor: gold,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5,3],
          pointRadius: 0,
          fill: false,
          tension: 0.4,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { font: { family: 'DM Mono', size: 10 } } } },
      scales: {
        x: { ticks: { font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
        y: { ticks: { font: { family: 'DM Mono', size: 10 } },
             title: { display: true, text: 'Differential (lower = better)', font: { family: 'DM Mono', size: 10 }, color: '#6b7059' } }
      }
    }
  });

  // Score differentials bar
  const ctx2 = document.getElementById('diff-chart').getContext('2d');
  diffChartInstance = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Score Differential',
        data: diffs,
        backgroundColor: diffs.map(d => d <= 0 ? 'rgba(45,106,79,0.7)' : 'rgba(192,57,43,0.5)'),
        borderColor:      diffs.map(d => d <= 0 ? green : '#c0392b'),
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
        y: { ticks: { font: { family: 'DM Mono', size: 10 } } }
      }
    }
  });
}

// ══════════════════════════════════════════
//  MEMBERS
// ══════════════════════════════════════════
let CLUB_ID        = '52147';  // updated after login from golfer profile
let ASSOCIATION_ID = '106';   // updated after login from golfer profile
let currentSubtab    = 'following';
let followingMembers = [];
let clubMembers      = [];

function switchSubtab(tab, btn) {
  currentSubtab = tab;
  document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('member-search').value = '';
  allMembers = tab === 'following' ? followingMembers : clubMembers;
  // Reset score fetch flag when switching tabs so scores reload if needed
  if (tab === 'following') memberScoresFetched = Object.keys(memberScoresCache).length > 0;
  if (allMembers.length === 0) {
    loadMembers();
  } else {
    renderMembersTable(allMembers);
  }
}

async function loadMembers() {
  const btn = document.getElementById('refresh-members-btn');
  btn.disabled = true;
  btn.textContent = '↻ Loading…';
  document.getElementById('members-tbody').innerHTML =
    '<tr><td colspan="6" class="loading"><span class="spinner"></span>Loading…</td></tr>';

  try {
    if (currentSubtab === 'following') {
      // Load golfers the user is following
      const res  = await fetch(
        `${API_BASE}/followed_golfers/${GOLFER_ID}.json?source=GHINcom`,
        { headers: authHeaders() }
      );
      const data = await res.json();
      followingMembers = data.golfers || [];
      allMembers = followingMembers;
      populateCompareSelects();
    } else {
      // Page through all Geneva Golf Club members
      let page = 1;
      let allPages = [];
      while (true) {
        const url = `${API_BASE}/golfers/search.json?` + new URLSearchParams({
          club_id: CLUB_ID,
          association_id: ASSOCIATION_ID,
          source: 'GHINcom',
          page: page,
          per_page: 100,
          status: 'Active'
        });
        const res  = await fetch(url, { headers: authHeaders() });
        const data = await res.json();
        const batch = data.golfers || [];
        allPages = allPages.concat(batch);
        if (batch.length < 100) break;
        page++;
      }
      clubMembers = allPages;
      allMembers  = clubMembers;
    }
    renderMembersTable(allMembers);
  } catch(e) {
    document.getElementById('members-tbody').innerHTML =
      `<tr><td colspan="6" class="empty-state">⚠ Could not load: ${e.message}</td></tr>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

function renderMembersTable(members) {
  const tbody = document.getElementById('members-tbody');
  document.getElementById('member-count').textContent = `${members.length} golfers`;

  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No members found.</td></tr>';
    return;
  }

  tbody.innerHTML = members.map(m => {
    const name   = `${m.first_name||''} ${m.last_name||''}`.trim() || '—';
    const ghin   = m.id || m.ghin_number || '—';
    const hcp    = fmtHcp(m.handicap_index_display ?? m.hi_display ?? m.hi_value ?? m.handicap_index);
    const loHcp  = fmtHcp(m.low_hi_display ?? m.low_hi_value);
    const cached = memberScoresCache[m.id];
    const lastDiff = cached && cached.length
      ? (() => {
          const d = parseFloat(cached[0]?.adjusted_scaled_up_differential ?? cached[0]?.scaled_up_differential ?? cached[0]?.differential);
          return isNaN(d) ? '—' : diffBadge(d);
        })()
      : '<span style="font-size:0.65rem;color:var(--muted)">—</span>';
    const recentDiffs = cached && cached.length
      ? cached.slice(0,5).map(s => {
          const d = parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential);
          return isNaN(d) ? '' : `<span style="font-size:0.65rem;padding:0.1rem 0.3rem;margin-right:2px;background:${d<=0?'#e8f5ee':'#fde8e8'};color:${d<=0?'#2d6a4f':'#c0392b'}">${d.toFixed(1)}</span>`;
        }).join('')
      : '<span style="font-size:0.65rem;color:var(--muted)">loading…</span>';
    return `<tr>
      <td><strong>${name}</strong></td>
      <td style="font-size:0.75rem;color:var(--muted)">${ghin}</td>
      <td><span class="hcp-pill">${hcp}</span></td>
      <td style="font-size:0.75rem;color:var(--green-mid)">${loHcp}</td>
      <td>${lastDiff}</td>
      <td>${recentDiffs}</td>
    </tr>`;
  }).join('');

  // Fetch scores for following list progressively if not yet loaded
  if (currentSubtab === 'following' && members.length > 0 && !memberScoresFetched) {
    memberScoresFetched = true;
    loadFollowingScores(members);
  }
}

async function loadFollowingScores(members) {
  // Fetch last 5 scores for each followed golfer in batches of 5
  const BATCH = 5;
  for (let i = 0; i < members.length; i += BATCH) {
    const batch = members.slice(i, i + BATCH);
    await Promise.all(batch.map(async m => {
      try {
        const res  = await fetch(
          `${API_BASE}/golfers/${m.id}/scores.json?per_page=20&page=1&source=GHINcom`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        const rev = (data.revision_scores && data.revision_scores.scores) || [];
        const rec = (data.recent_scores   && data.recent_scores.scores)   || [];
        const seen = new Set();
        memberScoresCache[m.id] = [...rev, ...rec]
          .filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
          .sort((a,b) => new Date(b.played_at) - new Date(a.played_at))
          .slice(0, 5);
      } catch(e) {
        memberScoresCache[m.id] = [];
      }
    }));
    // Re-render after each batch so scores appear progressively
    const currentList = currentSubtab === 'following' ? followingMembers : clubMembers;
    renderMembersTable(currentList);
  }
}

function filterMembers() {
  // Local filter on already-loaded following list
  const q = document.getElementById('member-search').value.toLowerCase().trim();
  const source = currentSubtab === 'following' ? followingMembers : clubMembers;
  if (!q) { renderMembersTable(source); return; }
  const filtered = source.filter(m =>
    (`${m.first_name||''} ${m.last_name||''}`).toLowerCase().includes(q) ||
    String(m.id || m.ghin_number || '').includes(q) ||
    (m.club_name || '').toLowerCase().includes(q)
  );
  renderMembersTable(filtered);
}

async function doMemberSearch() {
  const q = document.getElementById('member-search').value.trim();
  if (!q) {
    // Reset to default list
    const source = currentSubtab === 'following' ? followingMembers : clubMembers;
    renderMembersTable(source);
    return;
  }

  document.getElementById('members-tbody').innerHTML =
    '<tr><td colspan="6" class="loading"><span class="spinner"></span>Searching…</td></tr>';
  document.getElementById('member-count').textContent = '';

  const isGhinNumber = /^\d+$/.test(q);
  const BASE = 'https://api2.ghin.com/api/v1';
  const ASSOC = '106';
  const CLUB  = '52147';

  try {
    let results = [];

    if (isGhinNumber) {
      // Search by GHIN number — try golfer_id and ghin_number params
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}/golfers/search.json?per_page=25&page=1&golfer_id=${q}&sorting_criteria=id&order=ASC&status=Active&association_id=${ASSOC}&source=GHINcom`, { headers: authHeaders() }),
        fetch(`${BASE}/golfers/search.json?per_page=25&page=1&ghin_number=${q}&sorting_criteria=id&order=ASC&status=Active&association_id=${ASSOC}&source=GHINcom`, { headers: authHeaders() })
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const seen = new Set();
      for (const g of [...(d1.golfers||[]), ...(d2.golfers||[])]) {
        if (!seen.has(g.id)) { seen.add(g.id); results.push(g); }
      }
    } else {
      // Search by last name — try club first, then association fallback
      const [r1, r2, r3] = await Promise.all([
        fetch(`${BASE}/golfers.json?per_page=25&page=1&club_id=${CLUB}&last_name=${encodeURIComponent(q)}&source=GHINcom`, { headers: authHeaders() }),
        fetch(`${BASE}/golfers/search.json?per_page=25&page=1&club_id=${CLUB}&last_name=${encodeURIComponent(q)}&sorting_criteria=id&order=ASC&status=Active&source=GHINcom`, { headers: authHeaders() }),
        fetch(`${BASE}/golfers/search.json?per_page=25&page=1&last_name=${encodeURIComponent(q)}&sorting_criteria=id&order=ASC&status=Active&association_id=${ASSOC}&source=GHINcom`, { headers: authHeaders() })
      ]);
      const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      const seen = new Set();
      for (const g of [...(d1.golfers||[]), ...(d2.golfers||[]), ...(d3.golfers||[])]) {
        if (!seen.has(g.id)) { seen.add(g.id); results.push(g); }
      }
    }

    renderMembersTable(results);
    if (!results.length) {
      document.getElementById('members-tbody').innerHTML =
        '<tr><td colspan="6" class="empty-state">No golfers found for that search.</td></tr>';
    }
  } catch(e) {
    document.getElementById('members-tbody').innerHTML =
      `<tr><td colspan="6" class="empty-state">⚠ Search failed: ${e.message}</td></tr>`;
  }
}

// ══════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════
function showTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  // Auto-load form analysis when tab is opened
  if (name === 'form' && !formAnalysisRun) loadFormAnalysis();
  // Auto-populate compare/matchup selects when compare tab opened
  if (name === 'compare' && followingMembers.length) populateCompareSelects();
}

// ══════════════════════════════════════════
//  COMPARE
// ══════════════════════════════════════════
let compareGolfers = []; // [{id, name, hcp, scores}]
let compareChartInstance = null;
const COMPARE_COLORS = ['#2d6a4f','#c9a84c','#c0392b','#2980b9'];

function populateCompareSelects() {
  // Build clickable roster cards for Compare tab
  const roster = document.getElementById('compare-roster');
  if (!roster) return;

  if (!followingMembers.length) {
    roster.innerHTML = '<span style="font-size:0.7rem;color:var(--muted)">No following list loaded yet — visit the Following tab first.</span>';
    return;
  }

  // Build roster — include logged-in user first, then following list
  const myHcp = fmtHcp(document.querySelector('#my-stats .stat-value')?.textContent) || '—';
  const selfBtn = `<button
    id="roster-btn-${GOLFER_ID}"
    onclick="toggleCompareGolfer('${GOLFER_ID}', true)"
    style="padding:0.4rem 0.85rem;border:2px solid var(--gold);background:var(--white);
           font-family:'DM Mono',monospace;font-size:0.7rem;color:var(--ink);cursor:pointer;
           transition:all 0.15s;letter-spacing:0.04em">
    ${CURRENT_USER_NAME} <span style="color:var(--gold);font-size:0.6rem">YOU</span> <span style="color:var(--muted)">(${myHcp})</span>
  </button>`;

  const memberBtns = followingMembers.map(m => {
    const hcp = fmtHcp(m.handicap_index_display ?? m.hi_display ?? m.hi_value ?? m.handicap_index);
    return `<button
      id="roster-btn-${m.id}"
      onclick="toggleCompareGolfer(${m.id})"
      style="padding:0.4rem 0.85rem;border:1px solid var(--cream-dark);background:var(--white);
             font-family:'DM Mono',monospace;font-size:0.7rem;color:var(--ink);cursor:pointer;
             transition:all 0.15s;letter-spacing:0.04em">
      ${m.first_name} ${m.last_name} <span style="color:var(--muted)">(${hcp})</span>
    </button>`;
  }).join('');

  roster.innerHTML = selfBtn + memberBtns;

  // Populate matchup selects — include self
  const selfOpt = `<option value="${GOLFER_ID}">Me (${CURRENT_USER_NAME})</option>`;
  const matchupOpts = selfOpt + followingMembers.map(m => {
    const hcp = fmtHcp(m.handicap_index_display ?? m.hi_display ?? m.hi_value ?? m.handicap_index);
    return `<option value="${m.id}">${m.first_name} ${m.last_name} (${hcp})</option>`;
  }).join('');
  document.getElementById('matchup-g1').innerHTML = '<option value="">— Select golfer —</option>' + matchupOpts;
  document.getElementById('matchup-g2').innerHTML = '<option value="">— Select golfer —</option>' + matchupOpts;
}

async function toggleCompareGolfer(id, isMe = false) {
  // If already added, remove
  if (compareGolfers.find(g => g.id == id)) {
    removeFromCompare(id);
    const btn = document.getElementById(`roster-btn-${id}`);
    if (btn) {
      btn.style.background = 'var(--white)';
      btn.style.color = 'var(--ink)';
      btn.style.borderColor = isMe ? 'var(--gold)' : 'var(--cream-dark)';
      btn.style.borderWidth = isMe ? '2px' : '1px';
    }
    return;
  }
  if (compareGolfers.length >= 4) { alert('Maximum 4 golfers'); return; }

  // Handle logged-in user
  if (isMe) {
    const colorIdx = compareGolfers.length;
    const btn = document.getElementById(`roster-btn-${id}`);
    if (btn) { btn.style.background = COMPARE_COLORS[colorIdx]; btn.style.color = '#fff'; btn.style.borderColor = COMPARE_COLORS[colorIdx]; }
    const res  = await fetch(`${API_BASE}/golfers/${GOLFER_ID}/scores.json?per_page=20&page=1&source=GHINcom`, { headers: authHeaders() });
    const data = await res.json();
    const rev = (data.revision_scores && data.revision_scores.scores) || [];
    const rec = (data.recent_scores   && data.recent_scores.scores)   || [];
    const seen = new Set();
    const scores = [...rev, ...rec].filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
      .sort((a,b) => new Date(b.played_at) - new Date(a.played_at)).slice(0, 10);
    compareGolfers.push({ id: GOLFER_ID, name: CURRENT_USER_NAME, hcp: CURRENT_USER_HCP_RAW, hcpDisplay: fmtHcp(CURRENT_USER_HCP_RAW), loDisplay: CURRENT_USER_LO_HCP, scores });
    renderCompare();
    return;
  }

  const m = followingMembers.find(f => f.id == id);
  if (!m) return;

  // Highlight the button
  const colorIdx = compareGolfers.length;
  const btn = document.getElementById(`roster-btn-${id}`);
  if (btn) {
    btn.style.background = COMPARE_COLORS[colorIdx];
    btn.style.color = '#fff';
    btn.style.borderColor = COMPARE_COLORS[colorIdx];
  }

  // Fetch their scores
  const res  = await fetch(`${API_BASE}/golfers/${id}/scores.json?per_page=20&page=1&source=GHINcom`, { headers: authHeaders() });
  const data = await res.json();
  const revScores = (data.revision_scores && data.revision_scores.scores) || [];
  const recScores = (data.recent_scores   && data.recent_scores.scores)   || [];
  const seen = new Set();
  const scores = [...revScores, ...recScores].filter(s => {
    if (seen.has(s.id)) return false; seen.add(s.id); return true;
  }).sort((a,b) => new Date(b.played_at) - new Date(a.played_at)).slice(0, 10);

  const rawHcp = m.handicap_index_display ?? m.hi_display ?? m.hi_value ?? m.handicap_index ?? '0';
  const hcpDisplay = fmtHcp(rawHcp);
  compareGolfers.push({
    id,
    name: `${m.first_name} ${m.last_name}`.trim(),
    hcp: rawHcp,         // store raw string for display via fmtHcp
    hcpDisplay,
    loDisplay: fmtHcp(m.low_hi_display ?? m.low_hi_value) || '—',
    scores
  });

  renderCompare();
}



function clearCompare() {
  compareGolfers = [];
  renderCompare();
  if (compareChartInstance) { compareChartInstance.destroy(); compareChartInstance = null; }
}

function removeFromCompare(id) {
  compareGolfers = compareGolfers.filter(g => g.id != id);
  // Reset roster button color
  const btn = document.getElementById(`roster-btn-${id}`);
  if (btn) {
    btn.style.background = 'var(--white)';
    btn.style.color = 'var(--ink)';
    btn.style.borderColor = 'var(--cream-dark)';
  }
  // Re-color remaining buttons
  compareGolfers.forEach((g, i) => {
    const b = document.getElementById(`roster-btn-${g.id}`);
    if (b) { b.style.background = COMPARE_COLORS[i]; b.style.borderColor = COMPARE_COLORS[i]; b.style.color = '#fff'; }
  });
  renderCompare();
}

function renderCompare() {
  // Chips
  const chips = document.getElementById('compare-chips');
  chips.innerHTML = compareGolfers.map((g, i) =>
    `<span style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.3rem 0.75rem;background:${COMPARE_COLORS[i]};color:#fff;font-size:0.7rem;letter-spacing:0.05em">
      ${g.name}
      <span onclick="removeFromCompare('${g.id}')" style="cursor:pointer;font-size:0.9rem;line-height:1">×</span>
    </span>`
  ).join('');

  if (!compareGolfers.length) {
    document.getElementById('compare-stats-grid').innerHTML = '';
    document.getElementById('compare-chart-wrap').style.display = 'none';
    document.getElementById('compare-table-wrap').style.display = 'none';
    return;
  }

  // Stat cards per golfer
  document.getElementById('compare-stats-grid').innerHTML = compareGolfers.map((g, i) => {
    const scores = g.scores;
    const scoreDiffs = scores.map(s => parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential)).filter(n => !isNaN(n));
    const avg = scoreDiffs.length
      ? (scoreDiffs.reduce((a,b)=>a+b,0)/scoreDiffs.length).toFixed(2)
      : '—';
    const diffs = scores.map(s => parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential)).filter(n => !isNaN(n));
    const trend = diffs.length >= 2 ? (diffs[0] - diffs[diffs.length-1]).toFixed(1) : '—';
    const trendVal = parseFloat(trend);
    const trendStr = trend !== '—'
      ? (trendVal < 0
          ? `<span class="trend-down">↑ Improving (${trend})</span>`
          : trendVal > 0
            ? `<span class="trend-up">↓ Declining (${trend})</span>`
            : `<span style="color:var(--muted)">→ Flat</span>`)
      : '—';
    return `<div class="stat-card" style="border-top:4px solid ${COMPARE_COLORS[i]}">
      <div class="stat-label">${g.name}</div>
      <div class="stat-value">${g.hcpDisplay || fmtHcp(g.hcp)}</div>
      <div class="stat-sub">Low: ${g.loDisplay}</div>
      <div class="stat-sub" style="margin-top:0.3rem">Avg (last 10): <strong>${avg}</strong></div>
      <div class="stat-sub">Trend: ${trendStr}</div>
    </div>`;
  }).join('');

  // Trend chart
  const allLabels = [];
  compareGolfers.forEach(g => {
    g.scores.forEach(s => { if (!allLabels.includes(s.played_at)) allLabels.push(s.played_at); });
  });
  allLabels.sort();

  document.getElementById('compare-chart-wrap').style.display = 'block';
  if (compareChartInstance) compareChartInstance.destroy();
  const ctx = document.getElementById('compare-chart').getContext('2d');
  compareChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels.map(d => fmtDate(d)),
      datasets: compareGolfers.map((g, i) => {
        const scoreMap = {};
        g.scores.forEach(s => {
          const d = parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential);
          if (!isNaN(d)) scoreMap[s.played_at] = d;
        });
        return {
          label: g.name,
          data: allLabels.map(d => scoreMap[d] != null ? scoreMap[d] : null),
          borderColor: COMPARE_COLORS[i],
          backgroundColor: COMPARE_COLORS[i] + '22',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: COMPARE_COLORS[i],
          fill: false,
          tension: 0.3,
          spanGaps: true
        };
      })
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { font: { family: 'DM Mono', size: 11 } } } },
      scales: {
        x: { ticks: { font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
        y: { ticks: { font: { family: 'DM Mono', size: 10 } },
             title: { display: true, text: 'Differential (lower = better)', font: { family: 'DM Mono', size: 10 }, color: 'var(--muted)' } }
      }
    }
  });

  // Recent scores table
  document.getElementById('compare-table-wrap').style.display = 'block';
  const maxRounds = Math.max(...compareGolfers.map(g => g.scores.length));
  document.getElementById('compare-thead').innerHTML =
    '<th>#</th>' + compareGolfers.map((g,i) =>
      `<th colspan="2" style="background:${COMPARE_COLORS[i]}88">${g.name}</th>`
    ).join('');
  document.getElementById('compare-tbody').innerHTML = Array.from({length: maxRounds}, (_,ri) =>
    `<tr><td style="font-size:0.7rem;color:var(--muted)">${ri+1}</td>` +
    compareGolfers.map(g => {
      const s = g.scores[ri];
      if (!s) return '<td>—</td><td>—</td>';
      const diff = parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential);
      return `<td style="font-size:0.75rem">${fmtDate(s.played_at)}<br><span style="font-size:0.65rem;color:var(--muted)">${s.facility_name||''}</span></td>
              <td><strong>${s.adjusted_gross_score||'—'}</strong> ${diffBadge(isNaN(diff)?null:diff)}</td>`;
    }).join('') + '</tr>'
  ).join('');
}

// ══════════════════════════════════════════
//  MATCHUP
// ══════════════════════════════════════════
function updateLiveMatchup() {
  const g1id  = document.getElementById('matchup-g1').value;
  const g2id  = document.getElementById('matchup-g2').value;
  const slope = parseFloat(document.getElementById('matchup-slope').value);
  const rating = parseFloat(document.getElementById('matchup-rating').value);
  const par   = parseInt(document.getElementById('matchup-par').value) || 72;
  const preview = document.getElementById('matchup-live-preview');

  if (!g1id || !g2id || g1id === g2id) { preview.style.display = 'none'; return; }

  function getMember(id) {
    if (id == GOLFER_ID) return { name: CURRENT_USER_NAME, hcp: null };
    const m = followingMembers.find(m => m.id == id);
    if (!m) return null;
    const raw = m.handicap_index_display ?? m.hi_display ?? m.hi_value ?? m.handicap_index ?? '0';
    const s = String(raw).trim();
    const hcpNum = s.startsWith('+') ? -parseFloat(s.substring(1)) : parseFloat(s) || 0;
    return { name: `${m.first_name} ${m.last_name}`, hcp: hcpNum };
  }

  const g1 = getMember(g1id);
  const g2 = getMember(g2id);
  if (!g1 || !g2) { preview.style.display = 'none'; return; }

  // Course handicap if rating/slope available, else raw HI difference
  let prob1 = 50;
  let detail = '';

  if (g1.hcp != null && g2.hcp != null) {
    const chcp1 = !isNaN(slope) ? Math.round(g1.hcp * (slope/113) + (isNaN(rating) ? 0 : rating - par)) : Math.round(g1.hcp);
    const chcp2 = !isNaN(slope) ? Math.round(g2.hcp * (slope/113) + (isNaN(rating) ? 0 : rating - par)) : Math.round(g2.hcp);
    prob1 += (chcp2 - chcp1) * 3.5;
    detail += `Course HCP: ${g1.name} ${chcp1} · ${g2.name} ${chcp2}. `;
  }

  // Apply form adjustments if cached
  const form1 = formDataCache[g1id] ? analyzeForm(formDataCache[g1id]) : null;
  const form2 = formDataCache[g2id] ? analyzeForm(formDataCache[g2id]) : null;

  if (form1) { prob1 += (form1.formScore||0)*4; detail += `${g1.name}: ${form1.status}. `; }
  if (form2) { prob1 -= (form2.formScore||0)*4; detail += `${g2.name}: ${form2.status}. `; }

  const trendAdj = f => !f ? 0 : f.trend.includes('Improving') ? 3 : f.trend.includes('Declining') ? -3 : 0;
  const volAdj   = f => !f ? 0 : f.volatility.includes('Low') ? 2 : f.volatility.includes('High') ? -2 : 0;
  prob1 += trendAdj(form1) - trendAdj(form2);
  prob1 += volAdj(form1) - volAdj(form2);

  prob1 = Math.max(5, Math.min(95, Math.round(prob1)));
  const prob2 = 100 - prob1;

  document.getElementById('live-name1').textContent = `${g1.name} ${prob1}%`;
  document.getElementById('live-name2').textContent = `${prob2}% ${g2.name}`;
  document.getElementById('live-bar1').style.width = prob1 + '%';
  document.getElementById('live-bar1').textContent = prob1 + '%';
  document.getElementById('live-bar2').style.width = prob2 + '%';
  document.getElementById('live-bar2').textContent = prob2 + '%';
  document.getElementById('live-detail').textContent = detail + (!form1 && !form2 ? 'Run Form Analysis tab first for form-adjusted odds.' : '');
  preview.style.display = 'block';
}

async function runMatchup() {
  const g1id  = document.getElementById('matchup-g1').value;
  const g2id  = document.getElementById('matchup-g2').value;
  const rating = parseFloat(document.getElementById('matchup-rating').value);
  const slope  = parseFloat(document.getElementById('matchup-slope').value);
  const par    = parseInt(document.getElementById('matchup-par').value) || 72;

  if (!g1id || !g2id) { alert('Please select both golfers'); return; }
  if (g1id === g2id)  { alert('Please select two different golfers'); return; }
  if (isNaN(slope))   { alert('Please enter slope rating'); return; }

  const result = document.getElementById('matchup-result');
  result.innerHTML = '<div class="loading"><span class="spinner"></span>Calculating…</div>';

  // Get handicap indexes
  async function getHcp(id) {
    const m = followingMembers.find(m => m.id == id);
    const raw = m
      ? (m.handicap_index_display ?? m.hi_display ?? m.hi_value ?? m.handicap_index ?? '0')
      : await (async () => {
          const res  = await fetch(`${API_BASE}/golfers/search.json?golfer_id=${id}&per_page=25&page=1&source=GHINcom`, { headers: authHeaders() });
          const data = await res.json();
          const g = data.golfers && data.golfers[0];
          return g ? (g.hi_display ?? g.hi_value ?? g.handicap_index ?? '0') : '0';
        })();
    // "+2.7" string means plus handicap = mathematically negative (-2.7)
    const s = String(raw).trim();
    if (s.startsWith('+')) return -parseFloat(s.substring(1));
    return parseFloat(s) || 0;
  }

  function getName(id) {
    if (id == GOLFER_ID) return CURRENT_USER_NAME;
    const m = followingMembers.find(m => m.id == id);
    return m ? `${m.first_name} ${m.last_name}` : `Golfer ${id}`;
  }

  const [hcp1, hcp2] = await Promise.all([getHcp(g1id), getHcp(g2id)]);
  const name1 = getName(g1id);
  const name2 = getName(g2id);

  // Course handicap = HI × (Slope / 113) + (CR - Par)  [WHS formula]
  const courseHcp1 = Math.round(hcp1 * (slope / 113) + (isNaN(rating) ? 0 : rating - par));
  const courseHcp2 = Math.round(hcp2 * (slope / 113) + (isNaN(rating) ? 0 : rating - par));

  // Stroke play strokes given (lower hcp gives strokes to higher)
  const strokeDiff = Math.abs(courseHcp1 - courseHcp2);
  const strokeGiver = courseHcp1 < courseHcp2 ? name1 : name2;
  const strokeReceiver = courseHcp1 < courseHcp2 ? name2 : name1;

  // Match play allocation (strokes on hardest holes)
  const matchStrokes = Math.round(strokeDiff * 0.75); // 3/4 handicap for match play per USGA

  // ── WIN PROBABILITY ──────────────────────────────────────────────
  // Fetch form data if not already cached
  async function ensureFormData(id) {
    if (formDataCache[id]) return;
    try {
      let all = [];
      for (let page = 1; page <= 2; page++) {
        const res  = await fetch(`${API_BASE}/golfers/${id}/scores.json?per_page=20&page=${page}&source=GHINcom`, { headers: authHeaders() });
        const data = await res.json();
        const rev  = (data.revision_scores && data.revision_scores.scores) || [];
        const rec  = (data.recent_scores   && data.recent_scores.scores)   || [];
        const seen = new Set();
        const batch = [...rev, ...rec].filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
        all = all.concat(batch);
        if (batch.length < 20) break;
      }
      const seen2 = new Set();
      formDataCache[id] = all
        .filter(s => { if (seen2.has(s.id)) return false; seen2.add(s.id); return true; })
        .sort((a,b) => new Date(b.played_at) - new Date(a.played_at))
        .slice(0, 20);
    } catch(e) { formDataCache[id] = []; }
  }

  result.innerHTML = '<div class="loading"><span class="spinner"></span>Loading form data…</div>';
  await Promise.all([ensureFormData(g1id), ensureFormData(g2id)]);

  const form1 = formDataCache[g1id] ? analyzeForm(formDataCache[g1id]) : null;
  const form2 = formDataCache[g2id] ? analyzeForm(formDataCache[g2id]) : null;

  // Base: each stroke = ~3.5% edge
  let prob1 = 50 + (courseHcp2 - courseHcp1) * 3.5;

  // Form score: each 1.0 = ~4% swing (positive form = playing better = higher win%)
  if (form1) prob1 += (form1.formScore || 0) * 4;
  if (form2) prob1 -= (form2.formScore || 0) * 4;

  // Trend: improving = +3%, declining = -3%
  const trendAdj = f => !f ? 0 : f.trend.includes('Improving') ? 3 : f.trend.includes('Declining') ? -3 : 0;
  prob1 += trendAdj(form1) - trendAdj(form2);

  // Volatility: low vol = slight edge (consistency), high vol = slight disadvantage
  const volAdj = f => !f ? 0 : f.volatility.includes('Low') ? 2 : f.volatility.includes('High') ? -2 : 0;
  prob1 += volAdj(form1) - volAdj(form2);

  prob1 = Math.max(5, Math.min(95, Math.round(prob1)));
  const prob2 = 100 - prob1;
  const hasForm = form1 || form2;

  // Form factor rows
  function formRow(name, f, color) {
    if (!f) return `<tr><td style="color:${color};font-weight:600;padding:0.6rem 0.75rem">${name}</td><td colspan="4" style="font-size:0.72rem;color:var(--muted);padding:0.6rem 0.75rem">Insufficient data</td></tr>`;
    return `<tr>
      <td style="color:${color};font-weight:600;padding:0.6rem 0.75rem">${name}</td>
      <td style="padding:0.6rem 0.75rem;font-size:0.78rem">${f.formScore != null ? f.formScore.toFixed(2) : '—'}</td>
      <td style="padding:0.6rem 0.75rem;font-size:0.78rem;color:${f.trendColor}">${f.trend}</td>
      <td style="padding:0.6rem 0.75rem;font-size:0.78rem;color:${f.volColor}">${f.volatility}</td>
      <td style="padding:0.6rem 0.75rem;font-weight:600;color:${f.statusColor}">${f.status}</td>
    </tr>`;
  }

  result.innerHTML = `
    <div class="stat-grid" style="margin-bottom:1.5rem">
      <div class="stat-card" style="border-top:4px solid ${COMPARE_COLORS[0]}">
        <div class="stat-label">${name1}</div>
        <div class="stat-value">${fmtHcp(hcp1)}</div>
        <div class="stat-sub">Handicap Index · Course HCP: <strong>${courseHcp1}</strong></div>
        ${form1 ? `<div class="stat-sub" style="margin-top:0.3rem;color:${form1.statusColor}">${form1.status}</div>` : ''}
      </div>
      <div class="stat-card" style="border-top:4px solid ${COMPARE_COLORS[1]}">
        <div class="stat-label">${name2}</div>
        <div class="stat-value">${fmtHcp(hcp2)}</div>
        <div class="stat-sub">Handicap Index · Course HCP: <strong>${courseHcp2}</strong></div>
        ${form2 ? `<div class="stat-sub" style="margin-top:0.3rem;color:${form2.statusColor}">${form2.status}</div>` : ''}
      </div>
    </div>

    <!-- Win probability bar -->
    <div style="background:var(--white);border:1px solid var(--cream-dark);padding:1.5rem;margin-bottom:1.5rem">
      <div style="font-family:'DM Serif Display',serif;font-size:1.1rem;color:var(--green-deep);margin-bottom:1rem">Win Probability (Stroke Play)</div>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
        <span style="font-size:0.7rem;color:${COMPARE_COLORS[0]};font-weight:600;min-width:90px">${name1}</span>
        <div style="flex:1;height:32px;background:var(--cream-dark);overflow:hidden;display:flex;border-radius:2px">
          <div style="width:${prob1}%;background:${COMPARE_COLORS[0]};display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.8rem;font-weight:700">${prob1}%</div>
          <div style="width:${prob2}%;background:${COMPARE_COLORS[1]};display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.8rem;font-weight:700">${prob2}%</div>
        </div>
        <span style="font-size:0.7rem;color:${COMPARE_COLORS[1]};font-weight:600;min-width:90px;text-align:right">${name2}</span>
      </div>
      ${!hasForm ? '<p style="font-size:0.7rem;color:var(--muted)">⚠ No form data — probability based on handicap strokes only.</p>' : ''}

      <!-- Form factors table -->
      <div style="margin-top:1rem">
        <div style="font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.5rem">Form Factors</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--green-deep);color:var(--cream)">
            <th style="padding:0.5rem 0.75rem;text-align:left;font-size:0.6rem;letter-spacing:0.1em;font-weight:500">Golfer</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;font-size:0.6rem;letter-spacing:0.1em;font-weight:500">Form Score</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;font-size:0.6rem;letter-spacing:0.1em;font-weight:500">Trend</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;font-size:0.6rem;letter-spacing:0.1em;font-weight:500">Volatility</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;font-size:0.6rem;letter-spacing:0.1em;font-weight:500">Status</th>
          </tr></thead>
          <tbody>
            ${formRow(name1, form1, COMPARE_COLORS[0])}
            ${formRow(name2, form2, COMPARE_COLORS[1])}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Stroke allocations -->
    <div class="table-wrap">
      <table>
        <thead><tr><th>Format</th><th>Strokes</th><th>Detail</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Stroke Play</strong></td>
            <td>${strokeDiff === 0 ? 'Even' : strokeDiff + ' strokes'}</td>
            <td style="font-size:0.75rem;color:var(--muted)">${strokeDiff === 0 ? 'Dead even' : strokeGiver + ' gives ' + strokeDiff + ' stroke' + (strokeDiff>1?'s':'') + ' to ' + strokeReceiver}</td>
          </tr>
          <tr>
            <td><strong>Match Play</strong></td>
            <td>${matchStrokes === 0 ? 'Even' : matchStrokes + ' strokes'}</td>
            <td style="font-size:0.75rem;color:var(--muted)">${matchStrokes === 0 ? 'Dead even' : strokeGiver + ' gives ' + matchStrokes + ' stroke' + (matchStrokes>1?'s':'') + ' to ' + strokeReceiver + ' (¾ allowance)'}</td>
          </tr>
          <tr>
            <td><strong>Skins</strong></td>
            <td>${strokeDiff === 0 ? 'Even' : strokeDiff + ' strokes'}</td>
            <td style="font-size:0.75rem;color:var(--muted)">${strokeDiff === 0 ? 'Dead even' : strokeReceiver + ' gets ' + strokeDiff + ' pop' + (strokeDiff>1?'s':'') + ' spread across hardest holes'}</td>
          </tr>
          <tr>
            <td><strong>Stableford</strong></td>
            <td>Full handicap</td>
            <td style="font-size:0.75rem;color:var(--muted)">${name1}: ${courseHcp1} pts · ${name2}: ${courseHcp2} pts</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p style="font-size:0.62rem;color:var(--muted);margin-top:1rem;line-height:1.6">
      Win % uses handicap strokes (~3.5%/stroke) adjusted for form score (~4%/point), trend (±3%), and volatility (±2%). Capped at 5–95%.
      ${!isNaN(rating) ? 'Course: Rating ' + rating + ' / Slope ' + slope + ' / Par ' + par + '. WHS: HI × (Slope ÷ 113) + (CR − Par).' : ''}
      For entertainment only — not a betting model!
    </p>
  `;
}

// ══════════════════════════════════════════
//  FORM ANALYSIS
// ══════════════════════════════════════════
let formDataCache = {}; // id -> full scores array (up to 20)
let formAnalysisRun = false;

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid-1] + s[mid]) / 2;
}

function stdDev(arr) {
  if (arr.length < 2) return null;
  const mean = arr.reduce((a,b) => a+b, 0) / arr.length;
  const variance = arr.reduce((s,v) => s + (v-mean)**2, 0) / arr.length;
  return Math.sqrt(variance);
}

function getDiffs(scores) {
  return scores.map(s => {
    // Use GHIN's pre-calculated adjusted_scaled_up_differential as primary
    const stored = parseFloat(s.adjusted_scaled_up_differential ?? s.scaled_up_differential ?? s.differential);
    if (!isNaN(stored)) return stored;
    // Fall back to calculating it ourselves
    const ags   = parseFloat(s.adjusted_gross_score);
    const cr    = parseFloat(s.course_rating);
    const slope = parseFloat(s.slope_rating);
    if (!isNaN(ags) && !isNaN(cr) && !isNaN(slope) && slope > 0)
      return (ags - cr) * 113 / slope;
    return null;
  }).filter(d => d !== null);
}

function analyzeForm(scores) {
  const diffs = getDiffs(scores);
  if (diffs.length < 3) return null;

  // Baseline: median of last 20
  const baseline20 = diffs.slice(0, 20);
  const baseline = median(baseline20);

  // Recent weighted: last 5 with weights 35/25/20/12.5/7.5
  const weights = [0.35, 0.25, 0.20, 0.125, 0.075];
  const recent5 = diffs.slice(0, 5);
  let weightedSum = 0, weightTotal = 0;
  recent5.forEach((d, i) => {
    weightedSum  += d * weights[i];
    weightTotal  += weights[i];
  });
  const recentWeighted = weightTotal > 0 ? weightedSum / weightTotal : null;

  // Form score
  const formScore = (baseline != null && recentWeighted != null)
    ? baseline - recentWeighted : null;

  // Status
  let status = '—', statusColor = 'var(--muted)';
  if (formScore != null) {
    if (formScore >= 1.5)       { status = '🔥 Hot';     statusColor = '#c0392b'; }
    else if (formScore <= -1.5) { status = '🥶 Cold';    statusColor = '#2980b9'; }
    else                        { status = '😐 Neutral'; statusColor = 'var(--muted)'; }
  }

  // Trend: avg of last 3 vs prev 3
  let trend = '—', trendColor = 'var(--muted)';
  if (diffs.length >= 6) {
    const avg3recent = (diffs[0] + diffs[1] + diffs[2]) / 3;
    const avg3prev   = (diffs[3] + diffs[4] + diffs[5]) / 3;
    const trendDiff  = avg3prev - avg3recent; // positive = improving (lower is better)
    if      (trendDiff >= 1.0)  { trend = '↑ Improving'; trendColor = '#2d6a4f'; }
    else if (trendDiff <= -1.0) { trend = '↓ Declining'; trendColor = '#c0392b'; }
    else                        { trend = '→ Flat';      trendColor = 'var(--muted)'; }
  } else if (diffs.length >= 3) {
    trend = 'Insufficient';
  }

  // Volatility: std dev of last 10
  let volatility = '—', volColor = 'var(--muted)';
  const diffs10 = diffs.slice(0, 10);
  if (diffs10.length >= 3) {
    const sd = stdDev(diffs10);
    if      (sd < 2.0)  { volatility = `Low (${sd.toFixed(1)})`;    volColor = '#2d6a4f'; }
    else if (sd <= 4.0) { volatility = `Medium (${sd.toFixed(1)})`; volColor = '#c9a84c'; }
    else                { volatility = `High (${sd.toFixed(1)})`;   volColor = '#c0392b'; }
  }

  return { baseline, recentWeighted, formScore, status, statusColor, trend, trendColor, volatility, volColor, count: diffs.length };
}

async function loadFormAnalysis() {
  if (!followingMembers.length) {
    document.getElementById('form-tbody').innerHTML =
      '<tr><td colspan="7" class="empty-state">Visit the Following tab first to load your golfer list.</td></tr>';
    return;
  }

  document.getElementById('form-meta').textContent = 'Loading scores for all followed golfers…';
  document.getElementById('form-tbody').innerHTML =
    '<tr><td colspan="7" class="loading"><span class="spinner"></span>Fetching scores…</td></tr>';

  // Include yourself
  const allGolfers = [
    { id: GOLFER_ID, first_name: CURRENT_USER_NAME, last_name: '', isMe: true },
    ...followingMembers
  ];

  // Fetch up to 20 scores per golfer in batches of 4
  const BATCH = 4;
  for (let i = 0; i < allGolfers.length; i += BATCH) {
    const batch = allGolfers.slice(i, i + BATCH);
    await Promise.all(batch.map(async g => {
      if (formDataCache[g.id]) return; // already loaded
      try {
        let allScores = [];
        // Fetch pages until we have 20
        for (let page = 1; page <= 2; page++) {
          const res  = await fetch(
            `${API_BASE}/golfers/${g.id}/scores.json?per_page=20&page=${page}&source=GHINcom`,
            { headers: authHeaders() }
          );
          const data = await res.json();
          const rev = (data.revision_scores && data.revision_scores.scores) || [];
          const rec = (data.recent_scores   && data.recent_scores.scores)   || [];
          const seen = new Set();
          const batch = [...rev, ...rec].filter(s => {
            if (seen.has(s.id)) return false; seen.add(s.id); return true;
          });
          allScores = allScores.concat(batch);
          if (batch.length < 20) break;
        }
        const seen2 = new Set();
        formDataCache[g.id] = allScores
          .filter(s => { if (seen2.has(s.id)) return false; seen2.add(s.id); return true; })
          .sort((a,b) => new Date(b.played_at) - new Date(a.played_at))
          .slice(0, 20);
      } catch(e) {
        formDataCache[g.id] = [];
      }
    }));
    // Re-render progressively after each batch
    renderFormTable(allGolfers);
  }

  formAnalysisRun = true;
  document.getElementById('form-meta').textContent =
    `Analysis complete · ${allGolfers.length} golfers · using adjusted differentials`;
}

function renderFormTable(golfers) {
  const tbody = document.getElementById('form-tbody');
  const rows = golfers.map(g => {
    const name   = g.isMe
      ? `<strong>${g.first_name}</strong> <span style="font-size:0.6rem;color:var(--gold)">YOU</span>`
      : `<strong>${g.first_name} ${g.last_name||''}</strong>`;
    const scores = formDataCache[g.id];
    if (!scores) {
      return `<tr><td>${name}</td><td colspan="6" class="loading" style="font-size:0.7rem"><span class="spinner"></span>Loading…</td></tr>`;
    }
    if (!scores.length) {
      return `<tr><td>${name}</td><td colspan="6" style="font-size:0.7rem;color:var(--muted)">No scores available</td></tr>`;
    }
    const f = analyzeForm(scores);
    if (!f) {
      return `<tr><td>${name}</td><td colspan="6" style="font-size:0.7rem;color:var(--muted)">Insufficient data (${scores.length} rounds)</td></tr>`;
    }
    const fmt = n => n != null ? n.toFixed(2) : '—';
    const fsColor = f.formScore > 1.5 ? '#c0392b' : f.formScore < -1.5 ? '#2980b9' : 'var(--ink)';
    return `<tr>
      <td>${name}<br><span style="font-size:0.62rem;color:var(--muted)">${f.count} rounds</span></td>
      <td style="font-size:0.82rem">${fmt(f.baseline)}</td>
      <td style="font-size:0.82rem">${fmt(f.recentWeighted)}</td>
      <td style="font-size:0.82rem;font-weight:600;color:${fsColor}">${f.formScore > 0 ? '' : ''}${fmt(f.formScore)}</td>
      <td style="font-size:0.78rem;color:${f.trendColor}">${f.trend}</td>
      <td style="font-size:0.78rem;color:${f.volColor}">${f.volatility}</td>
      <td style="font-weight:600;color:${f.statusColor}">${f.status}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rows;
}

// Allow Enter key on login + pre-fill remembered username
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Restore remembered username
  const savedUsername = localStorage.getItem('ghin_username');
  const savedRemember = localStorage.getItem('ghin_remember');
  if (savedUsername && savedRemember === 'true') {
    document.getElementById('username').value = savedUsername;
    document.getElementById('remember-me').checked = true;
    // Focus password field since username is pre-filled
    document.getElementById('password').focus();
  }
});
