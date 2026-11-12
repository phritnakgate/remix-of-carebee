-- Enums
create type public.food_instruction as enum ('before_food', 'after_food', 'with_food', 'any');
create type public.time_slot as enum ('morning', 'afternoon', 'evening', 'bedtime');
create type public.dose_source as enum ('app', 'caregiver', 'device', 'simulated');
create type public.device_mode as enum ('real', 'simulated');

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_url text,
  preferred_language text not null default 'th',
  timezone text not null default 'Asia/Bangkok',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Caregiver links
create table public.caregiver_links (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null,
  caregiver_id uuid not null,
  created_at timestamptz not null default now(),
  unique (elder_id, caregiver_id),
  check (elder_id <> caregiver_id)
);
grant select, delete on public.caregiver_links to authenticated;
grant all on public.caregiver_links to service_role;
alter table public.caregiver_links enable row level security;

create policy "Members can view their links" on public.caregiver_links
for select to authenticated using (auth.uid() = elder_id or auth.uid() = caregiver_id);
create policy "Members can remove their links" on public.caregiver_links
for delete to authenticated using (auth.uid() = elder_id or auth.uid() = caregiver_id);

-- Access helper: the owner or a linked caregiver
create or replace function public.can_access(_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    _owner = auth.uid()
    or exists (
      select 1 from public.caregiver_links
      where elder_id = _owner and caregiver_id = auth.uid()
    )
  )
$$;

create or replace function public.is_linked(_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.caregiver_links
    where (elder_id = _other and caregiver_id = auth.uid())
       or (caregiver_id = _other and elder_id = auth.uid())
  )
$$;

create policy "View own or linked profiles" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_linked(id));
create policy "Insert own profile" on public.profiles
for insert to authenticated with check (id = auth.uid());
create policy "Update own profile" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Caregiver invites
create table public.caregiver_invites (
  code text primary key,
  elder_id uuid not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.caregiver_invites to authenticated;
grant all on public.caregiver_invites to service_role;
alter table public.caregiver_invites enable row level security;

create policy "Elders view own invites" on public.caregiver_invites
for select to authenticated using (elder_id = auth.uid());
create policy "Elders create own invites" on public.caregiver_invites
for insert to authenticated with check (elder_id = auth.uid() and used_by is null);
create policy "Elders delete own invites" on public.caregiver_invites
for delete to authenticated using (elder_id = auth.uid());

create or replace function public.accept_caregiver_invite(_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.caregiver_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into inv from public.caregiver_invites
  where code = upper(trim(_code)) for update;
  if not found then
    raise exception 'Invite code not found';
  end if;
  if inv.used_by is not null then
    raise exception 'Invite code already used';
  end if;
  if inv.expires_at < now() then
    raise exception 'Invite code expired';
  end if;
  if inv.elder_id = auth.uid() then
    raise exception 'You cannot use your own invite code';
  end if;
  insert into public.caregiver_links (elder_id, caregiver_id)
  values (inv.elder_id, auth.uid())
  on conflict (elder_id, caregiver_id) do nothing;
  update public.caregiver_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.elder_id;
end;
$$;
revoke execute on function public.accept_caregiver_invite(text) from public, anon;
grant execute on function public.accept_caregiver_invite(text) to authenticated;

-- Medicines
create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  dosage text,
  quantity integer not null default 0 check (quantity >= 0),
  pills_per_dose integer not null default 1 check (pills_per_dose > 0),
  food_instruction public.food_instruction not null default 'after_food',
  notes text,
  color text not null default 'blue',
  compartment integer check (compartment between 1 and 28),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medicines_owner_idx on public.medicines (owner_id);
grant select, insert, update, delete on public.medicines to authenticated;
grant all on public.medicines to service_role;
alter table public.medicines enable row level security;
create trigger medicines_updated_at before update on public.medicines
for each row execute function public.set_updated_at();

create policy "Access medicines" on public.medicines
for select to authenticated using (public.can_access(owner_id));
create policy "Insert medicines" on public.medicines
for insert to authenticated with check (public.can_access(owner_id));
create policy "Update medicines" on public.medicines
for update to authenticated using (public.can_access(owner_id)) with check (public.can_access(owner_id));
create policy "Delete medicines" on public.medicines
for delete to authenticated using (public.can_access(owner_id));

-- Weekly schedules
create table public.medication_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  slot public.time_slot not null,
  dose_time time not null,
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}',
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  unique (medicine_id, slot)
);
create index schedules_owner_idx on public.medication_schedules (owner_id);
grant select, insert, update, delete on public.medication_schedules to authenticated;
grant all on public.medication_schedules to service_role;
alter table public.medication_schedules enable row level security;

create policy "Access schedules" on public.medication_schedules
for select to authenticated using (public.can_access(owner_id));
create policy "Insert schedules" on public.medication_schedules
for insert to authenticated with check (public.can_access(owner_id));
create policy "Update schedules" on public.medication_schedules
for update to authenticated using (public.can_access(owner_id)) with check (public.can_access(owner_id));
create policy "Delete schedules" on public.medication_schedules
for delete to authenticated using (public.can_access(owner_id));

-- Devices
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  mode public.device_mode not null,
  key_prefix text,
  first_contact_at timestamptz,
  last_seen_at timestamptz,
  last_status jsonb not null default '{}'::jsonb,
  firmware text,
  created_at timestamptz not null default now()
);
create index devices_owner_idx on public.devices (owner_id);
grant select, insert, update, delete on public.devices to authenticated;
grant all on public.devices to service_role;
alter table public.devices enable row level security;

create policy "Access devices" on public.devices
for select to authenticated using (public.can_access(owner_id));
create policy "Owners add simulated devices" on public.devices
for insert to authenticated with check (owner_id = auth.uid() and mode = 'simulated' and first_contact_at is null);
create policy "Owners update devices" on public.devices
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners delete devices" on public.devices
for delete to authenticated using (owner_id = auth.uid());

-- Signed-in users can never fake telemetry on a real device
create or replace function public.guard_device_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if new.mode is distinct from old.mode or new.owner_id is distinct from old.owner_id then
      raise exception 'Device mode and owner cannot be changed';
    end if;
    if old.mode = 'real' and (
      new.last_seen_at is distinct from old.last_seen_at
      or new.first_contact_at is distinct from old.first_contact_at
      or new.last_status is distinct from old.last_status
      or new.firmware is distinct from old.firmware
      or new.key_prefix is distinct from old.key_prefix
    ) then
      raise exception 'Real device status can only be reported by the device';
    end if;
  end if;
  return new;
end;
$$;
create trigger devices_guard before update on public.devices
for each row execute function public.guard_device_update();

-- Device keys: hashed, readable only by the server
create table public.device_keys (
  device_id uuid primary key references public.devices(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);
grant all on public.device_keys to service_role;
alter table public.device_keys enable row level security;

-- Dose confirmations
create table public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  schedule_id uuid references public.medication_schedules(id) on delete set null,
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  scheduled_date date not null,
  slot public.time_slot not null,
  confirmed_at timestamptz not null default now(),
  source public.dose_source not null default 'app',
  device_id uuid references public.devices(id) on delete set null,
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  unique (schedule_id, scheduled_date)
);
create index dose_logs_owner_date_idx on public.dose_logs (owner_id, scheduled_date);
grant select, insert, update, delete on public.dose_logs to authenticated;
grant all on public.dose_logs to service_role;
alter table public.dose_logs enable row level security;

create policy "Access dose logs" on public.dose_logs
for select to authenticated using (public.can_access(owner_id));
create policy "Insert dose logs" on public.dose_logs
for insert to authenticated with check (public.can_access(owner_id) and source <> 'device');
create policy "Delete dose logs" on public.dose_logs
for delete to authenticated using (public.can_access(owner_id) and source <> 'device');

-- Device events
create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  owner_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  source public.device_mode not null,
  created_at timestamptz not null default now()
);
create index device_events_device_idx on public.device_events (device_id, created_at desc);
grant select, insert on public.device_events to authenticated;
grant all on public.device_events to service_role;
alter table public.device_events enable row level security;

create policy "Access device events" on public.device_events
for select to authenticated using (public.can_access(owner_id));
create policy "Insert simulated events only" on public.device_events
for insert to authenticated with check (
  owner_id = auth.uid() and source = 'simulated'
  and exists (select 1 from public.devices d where d.id = device_id and d.mode = 'simulated' and d.owner_id = auth.uid())
);

-- Realtime
alter publication supabase_realtime add table public.dose_logs;
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.device_events;
alter publication supabase_realtime add table public.medicines;
alter publication supabase_realtime add table public.medication_schedules;