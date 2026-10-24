-- Onboarding generator schema. Every row belongs to a project owned by the user who created it.

create extension if not exists pgcrypto;

create table if not exists public.health (
  id int primary key,
  note text not null default 'ok',
  checked_at timestamptz not null default now()
);
insert into public.health (id) values (1) on conflict do nothing;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  name text,
  status text not null default 'created',
  stage text not null default 'crawl',
  reused_crawl_from uuid references public.projects(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects (created_by, created_at desc);
create index if not exists projects_url_idx on public.projects (url, created_at desc);

create table if not exists public.crawl_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  url text not null,
  title text,
  markdown text,
  page_type text,
  rank_score int,
  word_count int,
  content_hash text,
  fetch_method text check (fetch_method in ('http', 'browser', 'cache')),
  status text not null default 'pending' check (status in ('pending', 'fetched', 'failed', 'skipped')),
  error text,
  fetched_at timestamptz,
  unique (project_id, url)
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('logo', 'image', 'screenshot', 'font', 'other')),
  storage_path text,
  source_url text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists assets_project_kind_source_idx on public.assets (project_id, kind, source_url);

create table if not exists public.project_models (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version int not null,
  model_json jsonb not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table if not exists public.design_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version int not null,
  tokens_json jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  question_key text not null,
  prompt text not null,
  kind text not null default 'text',
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  unique (project_id, question_key)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  question_key text not null,
  prompt text,
  answer jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, question_key)
);

create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  variant_key text not null,
  version int not null,
  spec_json jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'valid', 'invalid', 'published', 'superseded')),
  created_by_action text not null default 'generate',
  parent_id uuid references public.flows(id) on delete set null,
  diff jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, variant_key, version)
);

create table if not exists public.generated_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  path text not null,
  content text not null,
  version int not null,
  created_at timestamptz not null default now(),
  unique (flow_id, path)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'stalled')),
  progress real not null default 0,
  attempt int not null default 0,
  cursor jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, stage)
);

create table if not exists public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_events_project_idx on public.job_events (project_id, id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  flow_id uuid references public.flows(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_events (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects(id) on delete cascade,
  provider text not null,
  operation text not null,
  scope text,
  payload_summary text,
  ok boolean not null,
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists memory_events_project_idx on public.memory_events (project_id, id desc);

-- Memory store used when the Mubit memory API is unavailable for the configured key.
create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  scope text not null default 'project' check (scope in ('project', 'global')),
  agent_id text not null,
  kind text not null check (kind in ('fact', 'decision', 'outcome', 'lesson')),
  content text not null,
  source_url text,
  importance real not null default 0.5,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists memory_items_project_idx on public.memory_items (project_id, created_at desc);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  answers_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Row level security.
create or replace function public.owns_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = pid and p.created_by = auth.uid());
$$;

alter table public.health enable row level security;
alter table public.projects enable row level security;
alter table public.memory_items enable row level security;
alter table public.leads enable row level security;

drop policy if exists health_read on public.health;
create policy health_read on public.health for select to authenticated using (true);

drop policy if exists projects_owner on public.projects;
create policy projects_owner on public.projects for all to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['crawl_pages', 'assets', 'project_models', 'design_tokens', 'questions', 'answers',
                           'flows', 'generated_files', 'jobs', 'job_events', 'chat_messages', 'memory_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.owns_project(project_id)) with check (public.owns_project(project_id))', t || '_owner', t);
  end loop;
end $$;

drop policy if exists memory_items_owner on public.memory_items;
create policy memory_items_owner on public.memory_items for select to authenticated
  using (scope = 'global' or public.owns_project(project_id));

-- Generated flows are public pages, so anyone may submit a lead; only owners can read them.
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to anon, authenticated with check (true);
drop policy if exists leads_owner_read on public.leads;
create policy leads_owner_read on public.leads for select to authenticated
  using (exists (select 1 from public.flows f where f.id = flow_id and public.owns_project(f.project_id)));

-- Realtime for the live pipeline timeline.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jobs') then
    alter publication supabase_realtime add table public.jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'job_events') then
    alter publication supabase_realtime add table public.job_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'projects') then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;

-- Private storage buckets; the app serves files through signed URLs.
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('assets', 'assets', false) on conflict (id) do nothing;
