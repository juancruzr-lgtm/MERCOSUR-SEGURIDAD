-- Idempotent employee Auth columns for existing Mercosur Seguridad databases.
alter table usuarios add column if not exists email text;
alter table usuarios add column if not exists foto_url text;
alter table usuarios add column if not exists dni text;
alter table usuarios add column if not exists auth_user_id uuid references auth.users(id);
