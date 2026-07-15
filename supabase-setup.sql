-- supabase-setup.sql
-- Run this ONCE in your Supabase project: Dashboard -> SQL Editor -> paste -> Run.

-- Where every registration lands (both the Reserve My Seat form
-- and the calculator's "email me this estimate").
create table if not exists registrations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  first_name text not null default '',
  email text not null,
  normalized_email text not null unique,  -- <- this is what blocks duplicates & +alias tricks
  phone text not null default '',
  source text not null default 'workshop', -- 'workshop' or 'calculator'
  message text not null default ''
);

-- Per-IP submission counters for rate limiting.
create table if not exists rate_limits (
  ip text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

-- Lock both tables down. The Netlify function uses the service_role key,
-- which bypasses RLS — so with no policies defined, NOBODY else (including
-- anyone who finds your public anon key) can read or write these tables.
alter table registrations enable row level security;
alter table rate_limits enable row level security;
