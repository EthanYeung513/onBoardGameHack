/* Orthogonal world — procedural top-down pixel world + minigames.
   The same "world spec" (buildings per course, NPC positions, trivia)
   is what real agents would generate per-company. */
let CV, CX, running = false, HIRE_REF = null;
const T = 32, COLS = 30, ROWS = 18; // 960 x 576

/* ---- map ---- */
// tiles: 0 grass, 1 path, 2 water
const MAP = [];
for (let y = 0; y < ROWS; y++) { MAP[y] = []; for (let x = 0; x < COLS; x++) MAP[y][x] = 0; }
// paths: horizontal + vertical cross
for (let x = 0; x < COLS; x++) { MAP[13][x] = 1; MAP[14][x] = 1; }
for (let y = 0; y < ROWS; y++) { MAP[y][14] = 1; MAP[y][15] = 1; }
// pond bottom-left
[[2,15],[3,15],[4,15],[2,16],[3,16],[4,16],[2,17],[3,17],[5,16]].forEach(([x,y])=>MAP[y][x]=2);

/* ---- buildings: one per course ---- */
// rect [x,y,w,h] in tiles + door tile + course
const BUILDINGS = [
  { course: 'c1', name: 'HQ Hall',        x: 3,  y: 3, w: 6, h: 4, door: [5, 6],  roof: '#c1440e', wall: '#e8dcc8' },
  { course: 'c2', name: 'Community Hall', x: 20, y: 3, w: 6, h: 4, door: [22, 6], roof: '#7c3aed', wall: '#e8dcc8' },
  { course: 'c3', name: 'Workshop',       x: 7,  y: 9, w: 5, h: 3, door: [9, 11], roof: '#0891b2', wall: '#d9c9a8' },
  { course: 'c4', name: 'Dojo',           x: 20, y: 9, w: 5, h: 3, door: [22, 11],roof: '#101014', wall: '#d9c9a8' },
];
const BLOCKED = new Set();
BUILDINGS.forEach(b => { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) BLOCKED.add(x + ',' + y); });
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (MAP[y][x] === 2) BLOCKED.add(x + ',' + y);
// decorative trees
const TREES = [[1,1],[12,2],[28,2],[17,5],[2,9],[27,9],[1,12],[28,14],[26,16],[6,16],[12,17],[18,2],[24,16],[9,16]];
TREES.forEach(([x,y])=>BLOCKED.add(x+','+y));
// doors are walkable
BUILDINGS.forEach(b => BLOCKED.delete(b.door[0]+','+b.door[1]));

const player = { x: 15*T, y: 16*T, dir: 'down', step: 0, moving: false };
const keys = {};
let nearNPC = null, nearDoor = null, dlgOpen = false, mgOpen = false;

function startWorld(hire) {
  HIRE_REF = hire;
  CV = document.getElementById('game');
  CX = CV.getContext('2d');
  running = true;
  requestAnimationFrame(loop);
  // spawn markers for completed courses
}

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'e' || e.key === 'Enter') interact();
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
document.addEventListener('click', e => { if (dlgOpen) closeDlg(); });

let t0 = 0;
function loop(t) {
  if (!running) return;
  const dt = Math.min((t - t0) / 16.6, 3); t0 = t;
  update(dt); draw(t);
  requestAnimationFrame(loop);
}

function update(dt) {
  if (dlgOpen || mgOpen) { player.moving = false; return; }
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy = -1;
  if (keys['s'] || keys['arrowdown']) dy = 1;
  if (keys['a'] || keys['arrowleft']) dx = -1;
  if (keys['d'] || keys['arrowright']) dx = 1;
  player.moving = !!(dx || dy);
  if (player.moving) {
    player.dir = dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right';
    const sp = 2.4 * dt;
    const nx = player.x + dx * sp, ny = player.y + dy * sp;
    if (!blocked(nx, player.y)) player.x = nx;
    if (!blocked(player.x, ny)) player.y = ny;
    player.step += dt;
  }
  // proximity
  nearNPC = OB.NPCS.find(n => Math.hypot(n.x*T+16 - (player.x+8), n.y*T+16 - (player.y+10)) < 44) || null;
  nearDoor = null;
  for (const b of BUILDINGS) {
    if (Math.hypot(b.door[0]*T+16 - (player.x+8), b.door[1]*T+16 - (player.y+10)) < 50) nearDoor = b;
  }
}

function blocked(px, py) {
  const x = Math.floor((px+8)/T), y = Math.floor((py+10)/T);
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
  return BLOCKED.has(x+','+y);
}

/* ---------- drawing ---------- */
function draw(t) {
  const g = CX;
  // tiles
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const v = MAP[y][x], px = x*T, py = y*T;
    if (v === 0) {
      g.fillStyle = (x+y)%2 ? '#4da33d' : '#55ad43'; g.fillRect(px,py,T,T);
      if (((x*7+y*13)%17)===0){ g.fillStyle='#e8f7e0'; g.fillRect(px+14,py+12,3,3); g.fillRect(px+20,py+20,3,3); }
      if (((x*5+y*11)%23)===0){ g.fillStyle='#ffd2e0'; g.fillRect(px+10,py+16,4,4); }
    } else if (v === 1) {
      g.fillStyle = '#d9b982'; g.fillRect(px,py,T,T);
      g.fillStyle = '#c9a96e';
      if (((x*3+y*7)%9)===0) g.fillRect(px+8,py+10,5,4);
    } else {
      g.fillStyle = '#3f8fd2'; g.fillRect(px,py,T,T);
      g.fillStyle = '#5aa7e0';
      const w = Math.sin(t/400 + x)*4;
      g.fillRect(px+4, py+12+w, 14, 3); g.fillRect(px+16, py+22-w, 12, 3);
    }
  }
  // trees
  TREES.forEach(([x,y]) => drawTree(g, x*T, y*T));
  // buildings
  BUILDINGS.forEach(b => drawBuilding(g, b));
  // door hint
  if (nearDoor && !mgOpen && !dlgOpen) {
    const done = (HIRE_REF.games||{})[nearDoor.course];
    hint(g, nearDoor.door[0]*T+16, nearDoor.door[1]*T-14,
      done ? `${nearDoor.name} — replay (E)` : `Enter ${nearDoor.name} (E)`);
  }
  if (nearNPC && !dlgOpen && !mgOpen) hint(g, nearNPC.x*T+16, nearNPC.y*T-14, `Talk to ${nearNPC.name} (E)`);
  // NPCs + player (depth sort)
  const ents = OB.NPCS.map(n=>({y:n.y*T, f:()=>drawNPC(g,n)}));
  ents.push({y:player.y, f:()=>drawPlayer(g)});
  ents.sort((a,b)=>a.y-b.y).forEach(e=>e.f());
}

function drawTree(g, x, y) {
  g.fillStyle = '#6b4423'; g.fillRect(x+12, y+20, 8, 10);
  g.fillStyle = '#2d6e2d'; g.fillRect(x+4, y+8, 24, 14);
  g.fillStyle = '#3f8f3f'; g.fillRect(x+8, y+2, 16, 10);
  g.fillStyle = '#55ad43'; g.fillRect(x+12, y+4, 6, 4);
}

function drawBuilding(g, b) {
  const x=b.x*T, y=b.y*T, w=b.w*T, h=b.h*T;
  g.fillStyle = b.wall; g.fillRect(x, y+10, w, h-10);
  g.fillStyle = b.roof;
  g.beginPath(); g.moveTo(x-6, y+14); g.lineTo(x+w/2, y-8); g.lineTo(x+w+6, y+14); g.closePath(); g.fill();
  g.fillRect(x-4, y+10, w+8, 6);
  // door
  g.fillStyle = '#5a3a1e'; g.fillRect(b.door[0]*T+8, y+h-18, 16, 18);
  g.fillStyle = '#ffb31f'; g.fillRect(b.door[0]*T+18, y+h-9, 3, 3);
  // windows
  g.fillStyle = '#9fd8ef';
  g.fillRect(x+8, y+h-20, 10, 10); g.fillRect(x+w-18, y+h-20, 10, 10);
  // sign
  const done = (HIRE_REF && HIRE_REF.games||{})[b.course];
  g.fillStyle = done ? '#0e9f6e' : '#101014';
  g.fillRect(x+w/2-46, y+h+4, 92, 16);
  g.fillStyle = '#fff'; g.font = '9px monospace'; g.textAlign='center';
  g.fillText((done?'✓ ':'')+b.name.toUpperCase(), x+w/2, y+h+15);
}

function drawNPC(g, n) {
  const x=n.x*T, y=n.y*T, bob=Math.sin(Date.now()/500+n.x)*1.5;
  g.fillStyle = '#f2c9a0'; g.fillRect(x+9, y+2+bob, 14, 12); // head
  g.fillStyle = n.color; g.fillRect(x+8, y+14+bob, 16, 14);  // body
  g.fillStyle = '#2a2a33'; g.fillRect(x+9, y+28+bob, 5, 4); g.fillRect(x+18, y+28+bob, 5, 4);
  g.fillStyle = '#3a2a1a'; g.fillRect(x+9, y+1+bob, 14, 4); // hair
  g.fillStyle = '#101014'; g.font='8px monospace'; g.textAlign='center';
  g.fillText(n.name, x+16, y-4);
  const met = HIRE_REF && (HIRE_REF.npcsMet||[]).includes(n.name);
  if (!met) { g.fillStyle='#ffb31f'; g.fillRect(x+24,y-2+bob,5,5); }
}

function drawPlayer(g) {
  const x=player.x, y=player.y, ph=player.moving?Math.sin(player.step*.4)*3:0;
  g.fillStyle = '#f2c9a0'; g.fillRect(x+9, y+2, 14, 12);
  g.fillStyle = '#2f6bff'; g.fillRect(x+8, y+14, 16, 13);
  g.fillStyle = '#1a1a22';
  g.fillRect(x+9, y+27+Math.max(0,ph), 5, 5); g.fillRect(x+18, y+27+Math.max(0,-ph), 5, 5);
  g.fillStyle = '#3a2a1a'; g.fillRect(x+8, y, 16, 5);
  // eyes by dir
  g.fillStyle='#101014';
  if (player.dir==='down'){ g.fillRect(x+12,y+8,3,3); g.fillRect(x+18,y+8,3,3); }
  else if (player.dir==='left'){ g.fillRect(x+11,y+8,3,3); }
  else if (player.dir==='right'){ g.fillRect(x+19,y+8,3,3); }
}

function hint(g, x, y, text) {
  g.font = '11px monospace'; g.textAlign='center';
  const w = g.measureText(text).width + 16;
  g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(x-w/2, y-16, w, 20);
  g.strokeStyle = '#101014'; g.strokeRect(x-w/2, y-16, w, 20);
  g.fillStyle = '#101014'; g.fillText(text, x, y-2);
}

/* ---------- interactions ---------- */
function interact() {
  if (dlgOpen) { closeDlg(); return; }
  if (mgOpen) return;
  if (nearNPC) return openDlg(nearNPC);
  if (nearDoor) return launchCourse(nearDoor.course);
}
function openDlg(npc) {
  dlgOpen = true;
  const d = document.getElementById('dlg');
  document.getElementById('dlg-who').textContent = npc.name + ' · ' + npc.role;
  document.getElementById('dlg-text').textContent = '“' + npc.fact + '”';
  d.classList.add('open');
  OB.updateHire(HIRE_REF.email, h => { h.npcsMet = h.npcsMet||[]; if(!h.npcsMet.includes(npc.name)) h.npcsMet.push(npc.name); h.coins=(h.coins||0)+5; });
  document.getElementById('coin-count').textContent = OB.getHire(HIRE_REF.email).coins;
}
function closeDlg(){ dlgOpen=false; document.getElementById('dlg').classList.remove('open'); }

/* ---------- minigame framework ---------- */
function openMG(title, sub, html) {
  mgOpen = true;
  document.getElementById('mg').classList.add('open');
  document.getElementById('mg-body').innerHTML =
    `<h3>${title}</h3><div class="sub">${sub}</div>` + html;
}
function closeGame(){ mgOpen=false; document.getElementById('mg').classList.remove('open'); }

function finishCourse(courseId, scorePct, coinsEarned) {
  OB.updateHire(HIRE_REF.email, h => {
    const prev = (h.games||{})[courseId];
    if (!prev || scorePct > prev.score) {
      h.games = h.games||{};
      h.games[courseId] = { score: scorePct, at: Date.now() };
      h.coins = (h.coins||0) + coinsEarned;
    }
  });
  const h = OB.getHire(HIRE_REF.email);
  document.getElementById('coin-count').textContent = h.coins;
  const done = Object.keys(h.games).length;
  const bonus = done === OB.COURSES.length ? ' · World complete!' : '';
  return `<div class="mg-result"><div class="big">${scorePct>=80?OB.icon('trophy',44):scorePct>=50?OB.icon('star',44):OB.icon('book',44)}</div>
    <h4>${scorePct}%</h4>
    <p>+${coinsEarned} coins · ${done}/${OB.COURSES.length} buildings done${bonus}</p>
    <button class="btn btn-primary" style="margin-top:18px" onclick="closeGame()">Back to world</button></div>`;
}

function launchCourse(courseId) {
  const c = OB.COURSES.find(x=>x.id===courseId);
  if (c.game==='quiz') return gameQuiz(c);
  if (c.game==='inbox') return gameInbox(c);
  if (c.game==='road') return gameRoad(c);
  if (c.game==='scenario') return gameScenario(c);
}

/* ---- game 1: quiz sprint ---- */
function gameQuiz(c) {
  let i = 0, right = 0;
  function q() {
    if (i >= OB.QUIZ.length) {
      const score = Math.round(right/OB.QUIZ.length*100);
      document.getElementById('mg-body').innerHTML =
        `<h3>${OB.icon(c.icon)} ${c.title} — Quiz sprint</h3>` + finishCourse(c.id, score, right*20);
      return;
    }
    const item = OB.QUIZ[i];
    openMG(c.icon+' '+c.title+' — Quiz sprint', `Question ${i+1}/${OB.QUIZ.length} · ${OB.icon('building',14)} ${c.building}`,
      `<div class="mg-meta"><span>Correct: ${right}</span><span>${i+1}/${OB.QUIZ.length}</span></div>
       <div class="mg-q">${item.q}</div>
       <div class="mg-opts">${item.a.map((a,j)=>`<button class="mg-opt" onclick="quizPick(${j})">${a}</button>`).join('')}</div>`);
    window.quizPick = j => {
      const ok = j===item.correct; if (ok) right++;
      document.querySelectorAll('.mg-opt').forEach((b,k)=>{ if(k===item.correct) b.classList.add('correct'); else if(k===j) b.classList.add('wrong'); b.disabled=true; });
      i++; setTimeout(q, 750);
    };
  }
  q();
}

/* ---- game 2: inbox triage ---- */
function gameInbox(c) {
  let i = 0, right = 0;
  function card() {
    if (i >= OB.INBOX_CARDS.length) {
      const score = Math.round(right/OB.INBOX_CARDS.length*100);
      document.getElementById('mg-body').innerHTML = finishCourse(c.id, score, right*15);
      return;
    }
    const it = OB.INBOX_CARDS[i];
    openMG(c.icon+' '+c.title+' — Inbox triage', `Sort messages like a local would. ${i+1}/${OB.INBOX_CARDS.length}`,
      `<div class="inbox-card"><div class="from"><i>IN</i> Internal · #general</div>
       <div class="body">${it.text}</div>
       <div class="inbox-why" id="why"></div></div>
       <div style="display:flex;gap:10px">
         <button class="btn btn-dark" style="flex:1" onclick="triage(true)">Save — it\'s normal here</button>
         <button class="btn btn-ghost" style="flex:1" onclick="triage(false)">Trash — violates the rules</button>
       </div>`);
    window.triage = save => {
      const ok = save === it.save; if (ok) right++;
      const why = document.getElementById('why');
      why.className = 'inbox-why ' + (ok?'good':'bad');
      why.textContent = (ok?'✓ ':'✗ ') + it.why;
      document.querySelectorAll('#mg-body .btn').forEach(b=>b.disabled=true);
      i++; setTimeout(card, 1100);
    };
  }
  card();
}

/* ---- game 3: road run (timed lanes) ---- */
function gameRoad(c) {
  let i = 0, right = 0, timer;
  function q() {
    clearTimeout(timer);
    if (i >= OB.ROAD_QUESTIONS.length) {
      const score = Math.round(right/OB.ROAD_QUESTIONS.length*100);
      document.getElementById('mg-body').innerHTML = finishCourse(c.id, score, right*18);
      return;
    }
    const it = OB.ROAD_QUESTIONS[i];
    openMG(c.icon+' '+c.title+' — Road run', `Pick the right lane before time runs out. ${i+1}/${OB.ROAD_QUESTIONS.length}`,
      `<div class="mg-meta"><span>Correct: ${right}</span><span id="road-t">8s</span></div>
       <div class="road-q">${it.q}</div>
       <div class="road-lanes">${it.a.map((a,j)=>`<div class="lane" onclick="lane(${j})">Lane ${j+1}: ${a}</div>`).join('')}</div>`);
    let left = 8;
    const tEl = () => document.getElementById('road-t');
    timer = setInterval(()=>{ left--; if(tEl()) tEl().textContent = left+'s'; if(left<=0){ clearInterval(timer); i++; q(); } }, 1000);
    window.lane = j => {
      clearInterval(timer);
      const ok = j===it.correct; if (ok) right++;
      document.querySelectorAll('.lane').forEach((l,k)=>{ if(k===it.correct) l.classList.add('correct'); else if(k===j) l.classList.add('wrong'); });
      i++; setTimeout(q, 800);
    };
  }
  q();
}

/* ---- game 4: scenario dialogue ---- */
function gameScenario(c) {
  let step = 0, score = 0, max = 0;
  function line() {
    if (step >= OB.SCENARIO.length) {
      const pct = Math.round(score/max*100);
      document.getElementById('mg-body').innerHTML = finishCourse(c.id, pct, score*25);
      return;
    }
    const s = OB.SCENARIO[step];
    openMG(c.icon+' '+c.title+' — Live scenario', `Respond like you'd want a teammate to. ${step+1}/${OB.SCENARIO.length}`,
      `<div class="scn-from"><div class="fa">${s.from[0]}</div><div><b>${s.from}</b><span>${s.role}</span></div></div>
       <div class="scn-line">“${s.line}”</div>
       <div class="mg-opts">${s.options.map((o,j)=>`<button class="mg-opt" onclick="pickOpt(${j})">${o.text}</button>`).join('')}</div>
       <div id="scn-reply"></div>`);
    window.pickOpt = j => {
      const o = s.options[j];
      score += o.score; max += 2;
      document.querySelectorAll('.mg-opt').forEach(b=>b.disabled=true);
      document.getElementById('scn-reply').innerHTML =
        `<div class="scn-reply">“${o.reply}”</div>
         <button class="btn btn-primary" style="margin-top:14px" id="scn-next">Continue →</button>`;
      document.getElementById('scn-next').onclick = ()=>{ step++; line(); };
    };
  }
  line();
}
