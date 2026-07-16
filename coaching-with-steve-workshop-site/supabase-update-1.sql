-- supabase-update-1.sql
-- Run ONCE in Supabase -> SQL Editor (safe to run even on a table with data).
-- Adds unsubscribe support for the weekly reminder emails.

alter table registrations
  add column if not exists unsubscribed boolean not null default false,
  add column if not exists unsub_token uuid not null default gen_random_uuid();

create index if not exists idx_registrations_unsub_token on registrations (unsub_token);
