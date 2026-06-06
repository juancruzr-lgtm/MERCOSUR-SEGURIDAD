-- Minimal idempotent columns required for employee Auth management.
alter table usuarios add column if not exists email text;
alter table usuarios add column if not exists foto_url text;
