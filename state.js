/* Orthogonal mockup — shared fake "backend" backed by localStorage.
   Every page imports this. It simulates: space creation, website scraping,
   brand extraction, the company "brain", courses, hires and game progress. */
(function () {
  const KEY = 'orthogonal_state_v1';

  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { s = {}; }
    // merge agent-generated courses into the shared curriculum list
    (s.customCourses || []).forEach(c => { if (!COURSES.find(x => x.id === c.id)) COURSES.push(c); });
    // apply assistant edits to course lessons
    Object.entries(s.courseEdits || {}).forEach(([id, e]) => {
      const c = COURSES.find(x => x.id === id);
      if (c && e.lessons) c.lessons = e.lessons;
      if (c && e.title) c.title = e.title;
    });
    return s;
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
  function get() { return load(); }
  function patch(p) { const s = load(); Object.assign(s, p); save(s); return s; }
  function reset() { localStorage.removeItem(KEY); }

  /* ---------- fake brand extraction ---------- */
  const PALETTES = [
    { primary: '#2f6bff', accent: '#ff5c39', bg: '#101014', style: 'Bold geometric' },
    { primary: '#0e9f6e', accent: '#ffb31f', bg: '#0d1210', style: 'Glassmorphism' },
    { primary: '#7c3aed', accent: '#22d3ee', bg: '#120e1c', style: 'Neo-brutalist' },
    { primary: '#e11d48', accent: '#facc15', bg: '#140d0e', style: 'Swiss minimal' },
    { primary: '#0891b2', accent: '#fb923c', bg: '#0c1216', style: 'Soft gradient' },
    { primary: '#ca8a04', accent: '#3b82f6', bg: '#12100a', style: 'Editorial' },
  ];

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function brandFromWebsite(url) {
    let host = (url || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'acme.com';
    const name = host.split('.')[0];
    const pretty = name.charAt(0).toUpperCase() + name.slice(1);
    const p = PALETTES[hash(host) % PALETTES.length];
    return {
      company: pretty,
      host,
      primary: p.primary,
      accent: p.accent,
      bg: p.bg,
      style: p.style,
      initials: pretty.slice(0, 2).toUpperCase(),
      pages: 8 + (hash(host) % 41),
    };
  }

  /* ---------- fake "company brain" built from connected tools ---------- */
  const BRAIN_FACTS = [
    { cat: 'Glossary', text: '"LGTM" = the PR is approved and safe to merge.' },
    { cat: 'Glossary', text: '"EOD" here means 6pm in the employee\'s timezone, not HQ\'s.' },
    { cat: 'Glossary', text: '"The Vault" = the shared 1Password team vault. Never share secrets in Slack.' },
    { cat: 'People', text: 'Priya (VP Eng) reviews all architecture PRs — tag her early, not at the end.' },
    { cat: 'People', text: 'Marco owns the deploy pipeline. If CI is red >30min, ping him on Slack.' },
    { cat: 'People', text: 'It\'s Aisha from Design\'s birthday on Thursday — the team does cards in #general.' },
    { cat: 'Rituals', text: 'Standup is async in #standup, due by 10am local. No meetings before 11am.' },
    { cat: 'Rituals', text: 'Demo Day is every other Friday — anyone can show work-in-progress.' },
    { cat: 'Tools', text: 'Jira board names don\'t match team names — "FALCON" is the payments team.' },
    { cat: 'Tools', text: 'Staging deploys happen automatically on merge to main. prod needs a manual approve.' },
    { cat: 'History', text: 'The company pivoted in 2023 — old docs saying "Nimbus" refer to the old product.' },
    { cat: 'Culture', text: 'Cameras optional in every meeting except sprint kickoff.' },
  ];

  const COURSES = [
    { id: 'c1', title: 'Company 101', building: 'HQ Hall', icon: 'landmark', game: 'quiz',
      desc: 'History, mission, and how we talk to each other.',
      lessons: ['Origin story & pivot', 'Mission & values', 'Glossary & acronyms'] },
    { id: 'c2', title: 'People & Culture', building: 'Community Hall', icon: 'users', game: 'inbox',
      desc: 'Who\'s who, rituals, birthdays and unwritten rules.',
      lessons: ['Org map', 'Rituals & rhythms', 'Unwritten rules'] },
    { id: 'c3', title: 'Tools & Stack', building: 'Workshop', icon: 'wrench', game: 'road',
      desc: 'The stack you\'ll live in: repos, boards, deploys.',
      lessons: ['Repos & CI', 'Boards & tickets', 'Ship to prod'] },
    { id: 'c4', title: 'Hard Conversations', building: 'Dojo', icon: 'target', game: 'scenario',
      desc: 'Practice real scenarios with AI characters.',
      lessons: ['Giving feedback', 'Handling conflict', 'Escalating well'] },
  ];

  const REWARDS = [
    { id: 'r1', name: 'Coffee voucher — $5', cost: 120, icon: 'coffee' },
    { id: 'r2', name: 'Lunch on us — $15', cost: 300, icon: 'utensils' },
    { id: 'r3', name: 'Half-day Friday pass', cost: 800, icon: 'sun' },
    { id: 'r4', name: 'Team hoodie', cost: 500, icon: 'shirt' },
  ];

  const TOOLS = [
    { id: 'github', name: 'GitHub', icon: 'code', desc: 'Repos, PRs, code review norms' },
    { id: 'slack', name: 'Slack', icon: 'hash', desc: 'Channels, jargon, rituals' },
    { id: 'jira', name: 'Jira', icon: 'kanban', desc: 'Boards, sprint cadence' },
    { id: 'notion', name: 'Notion', icon: 'file', desc: 'Wikis, handbooks, docs' },
    { id: 'webapp', name: 'Internal web app', icon: 'globe', desc: 'Agent browses & learns the tool' },
    { id: 'files', name: 'Upload docs', icon: 'upload', desc: 'PDFs, decks, local tools\' docs' },
  ];

  const NPCS = [
    { name: 'Priya', role: 'VP Eng', fact: 'Tag me early on architecture PRs — I hate late surprises.', x: 14, y: 8, color: '#e11d48' },
    { name: 'Marco', role: 'DevOps', fact: 'CI red for 30+ min? That\'s me. Ping @marco on Slack.', x: 26, y: 10, color: '#0891b2' },
    { name: 'Aisha', role: 'Design Lead', fact: 'Psst — my birthday is Thursday. We do cards in #general.', x: 10, y: 18, color: '#ca8a04' },
    { name: 'Sam', role: 'People Ops', fact: 'Standup is async in #standup by 10am. First week, write more than feels necessary.', x: 22, y: 20, color: '#7c3aed' },
    { name: 'Lin', role: 'EM', fact: '"The Vault" = 1Password team vault. Secrets never go in Slack. Ever.', x: 17, y: 14, color: '#0e9f6e' },
  ];

  /* ---------- quiz content (from the "brain") ---------- */
  const QUIZ = [
    { q: 'A teammate replies "LGTM" on your PR. What does it mean?', a: ['Looks good to me — merge it', 'Let\'s get to Monday', 'Loop in the manager'], correct: 0 },
    { q: 'Where do secrets and passwords live?', a: ['#dev Slack channel', 'The Vault (1Password)', 'Jira ticket comments'], correct: 1 },
    { q: 'CI has been red for 45 minutes. Who do you ping?', a: ['Priya', 'Aisha', 'Marco'], correct: 2 },
    { q: 'Docs mention "Nimbus". What is it?', a: ['The staging cluster', 'The old product name', 'A code linter'], correct: 1 },
    { q: 'When is standup due?', a: ['10am local, async in #standup', '9am HQ time on Zoom', 'End of day'], correct: 0 },
  ];

  const INBOX_CARDS = [
    { text: '"Deploy Friday at 4:55pm?" — from a new hire', save: false, why: 'No Friday-evening deploys. Ever.' },
    { text: 'Async standup reminder for #standup', save: true, why: 'Standup is async, due 10am.' },
    { text: 'Credentials request — "just DM me the API key"', save: false, why: 'Secrets only in The Vault.' },
    { text: 'Demo Day sign-up sheet', save: true, why: 'Demo Day every other Friday.' },
    { text: 'Meeting invite at 9:30am', save: false, why: 'No meetings before 11am.' },
    { text: 'Aisha\'s birthday card — sign here', save: true, why: 'Team birthdays matter here.' },
  ];

  const ROAD_QUESTIONS = [
    { q: 'Main branch merges deploy to…', a: ['Production', 'Staging'], correct: 1 },
    { q: 'The "FALCON" Jira board belongs to…', a: ['Payments', 'Growth'], correct: 0 },
    { q: 'Production deploys need…', a: ['Manual approve', 'Nothing, auto'], correct: 0 },
    { q: 'PR review owner for architecture…', a: ['Marco', 'Priya'], correct: 1 },
    { q: 'Where does tribal knowledge live?', a: ['Slack + Jira + wikis', 'Only the handbook'], correct: 0 },
  ];

  const SCENARIO = [
    {
      from: 'Angry Co-worker', role: 'Team Lead',
      line: 'Your deploy broke the staging env AGAIN. Third time this sprint. What happened?',
      options: [
        { text: 'Sorry, not my fault — CI was already flaky.', score: 0, reply: '"Flaky" isn\'t a root cause. I need to know it won\'t happen again.' },
        { text: 'I missed the migration step. I\'ve rolled back and I\'m writing a checklist now.', score: 2, reply: 'Okay — thanks for owning it. Send me the checklist when it\'s done.' },
        { text: 'Can we talk about this after lunch?', score: 1, reply: 'Fine, but I want the postmortem before EOD.' },
      ],
    },
    {
      from: 'Angry Co-worker', role: 'Team Lead',
      line: 'And why didn\'t you flag it in standup this morning?',
      options: [
        { text: 'I hadn\'t diagnosed it yet. Next time I\'ll flag it as "investigating" so nobody\'s blocked.', score: 2, reply: 'That\'s exactly right. Flag early, even without answers.' },
        { text: 'I didn\'t want to look bad in front of the team.', score: 0, reply: 'Hiding problems looks worse than having them.' },
        { text: 'You weren\'t at standup anyway.', score: 0, reply: 'Deflecting isn\'t helping you here.' },
      ],
    },
  ];

  /* ---------- hire progress ---------- */
  function ensureHire(email) {
    const s = load();
    s.hires = s.hires || {};
    const key = email.trim().toLowerCase();
    if (!s.hires[key]) {
      s.hires[key] = {
        email: key,
        name: key.split('@')[0].replace(/[^a-z]/gi, ' ').trim() || 'New hire',
        joined: Date.now(),
        coins: 0,
        redeemed: [],
        games: {},
        npcsMet: [],
      };
      save(s);
    }
    return key;
  }

  function getHire(email) {
    const s = load();
    return (s.hires || {})[email.trim().toLowerCase()];
  }

  function updateHire(email, fn) {
    const s = load();
    const key = email.trim().toLowerCase();
    if (s.hires && s.hires[key]) { fn(s.hires[key]); save(s); }
  }

  function seedDemoHires() {
    const s = load();
    s.hires = s.hires || {};
    const demo = [
      ['mateo@' + (s.brand ? s.brand.host : 'acme.com'), 'Mateo Brooks', 79, 340],
      ['avery@' + (s.brand ? s.brand.host : 'acme.com'), 'Avery Collins', 83, 410],
      ['alex@' + (s.brand ? s.brand.host : 'acme.com'), 'Alex Romano', 70, 260],
      ['sofia@' + (s.brand ? s.brand.host : 'acme.com'), 'Sofia Navarro', 0, 0],
    ];
    demo.forEach(([email, name, pct, coins], i) => {
      if (!s.hires[email]) {
        const games = {};
        COURSES.forEach((c, j) => {
          if (pct >= (j + 1) * 25 - 10) games[c.id] = { score: 60 + ((i * 13 + j * 7) % 40), at: Date.now() - (j + i) * 86400000 };
        });
        s.hires[email] = { email, name, joined: Date.now() - (i + 2) * 86400000, coins, redeemed: [], games, npcsMet: [] };
      }
    });
    save(s);
  }

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    landmark: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    trophy: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/><line x1="9" y1="6" x2="9" y2="6.01"/><line x1="15" y1="6" x2="15" y2="6.01"/><line x1="9" y1="10" x2="9" y2="10.01"/><line x1="15" y1="10" x2="15" y2="10.01"/><line x1="9" y1="14" x2="9" y2="14.01"/><line x1="15" y1="14" x2="15" y2="14.01"/>',
    coin: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/>',
    sparkle: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    up: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    sidepanel: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
    wave: '<line x1="2" y1="10" x2="2" y2="14"/><line x1="6" y1="7" x2="6" y2="17"/><line x1="10" y1="4" x2="10" y2="20"/><line x1="14" y1="7" x2="14" y2="17"/><line x1="18" y1="10" x2="18" y2="14"/><line x1="22" y1="12" x2="22" y2="12"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  };

  function icon(n, s = 18) {
    return `<svg class="icn" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
  }

  window.OB = {
    get, patch, reset, save, load,
    brandFromWebsite, seedDemoHires,
    ensureHire, getHire, updateHire, icon,
    BRAIN_FACTS, COURSES, REWARDS, TOOLS, NPCS,
    QUIZ, INBOX_CARDS, ROAD_QUESTIONS, SCENARIO,
  };
})();
