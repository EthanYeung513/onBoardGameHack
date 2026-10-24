/* Orthogonal mockup — shared fake "backend" backed by localStorage.
   Every page imports this. It simulates: space creation, website scraping,
   brand extraction, the company "brain", courses, hires and game progress. */
(function () {
  const KEY = 'orthogonal_state_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return {}; }
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
    { id: 'c1', title: 'Company 101', building: 'HQ Hall', icon: '🏛️', game: 'quiz',
      desc: 'History, mission, and how we talk to each other.',
      lessons: ['Origin story & pivot', 'Mission & values', 'Glossary & acronyms'] },
    { id: 'c2', title: 'People & Culture', building: 'Community Hall', icon: '🎉', game: 'inbox',
      desc: 'Who\'s who, rituals, birthdays and unwritten rules.',
      lessons: ['Org map', 'Rituals & rhythms', 'Unwritten rules'] },
    { id: 'c3', title: 'Tools & Stack', building: 'Workshop', icon: '🛠️', game: 'road',
      desc: 'The stack you\'ll live in: repos, boards, deploys.',
      lessons: ['Repos & CI', 'Boards & tickets', 'Ship to prod'] },
    { id: 'c4', title: 'Hard Conversations', building: 'Dojo', icon: '⚔️', game: 'scenario',
      desc: 'Practice real scenarios with AI characters.',
      lessons: ['Giving feedback', 'Handling conflict', 'Escalating well'] },
  ];

  const REWARDS = [
    { id: 'r1', name: 'Coffee voucher — $5', cost: 120, emoji: '☕' },
    { id: 'r2', name: 'Lunch on us — $15', cost: 300, emoji: '🥪' },
    { id: 'r3', name: 'Half-day Friday pass', cost: 800, emoji: '🏖️' },
    { id: 'r4', name: 'Team hoodie', cost: 500, emoji: '🧥' },
  ];

  const TOOLS = [
    { id: 'github', name: 'GitHub', icon: '⌥', desc: 'Repos, PRs, code review norms' },
    { id: 'slack', name: 'Slack', icon: '#', desc: 'Channels, jargon, rituals' },
    { id: 'jira', name: 'Jira', icon: '▦', desc: 'Boards, sprint cadence' },
    { id: 'notion', name: 'Notion', icon: '◫', desc: 'Wikis, handbooks, docs' },
    { id: 'webapp', name: 'Internal web app', icon: '⌘', desc: 'Agent browses & learns the tool' },
    { id: 'files', name: 'Upload docs', icon: '⇪', desc: 'PDFs, decks, local tools\' docs' },
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

  window.OB = {
    get, patch, reset, save, load,
    brandFromWebsite, seedDemoHires,
    ensureHire, getHire, updateHire,
    BRAIN_FACTS, COURSES, REWARDS, TOOLS, NPCS,
    QUIZ, INBOX_CARDS, ROAD_QUESTIONS, SCENARIO,
  };
})();
