-- =====================================================================
-- 20260902090100_menu.sql
-- Catalogue: categories, items, modifier groups, modifiers.
-- Every table is tenant-scoped and cascades from tenants.
-- =====================================================================

set check_function_bodies = off;

create type public.modifier_selection_type as enum ('single', 'multiple');

-- ---------------------------------------------------------------------
-- menu_categories
-- ---------------------------------------------------------------------
create table public.menu_categories (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text,
  image_url    text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  -- Optional day-parting: null = always available
  available_from time,
  available_to   time,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint menu_categories_name_chk check (length(btrim(name)) between 1 and 120),
  constraint menu_categories_slug_chk check (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  constraint menu_categories_daypart_chk
    check ((available_from is null) = (available_to is null))
);

create unique index menu_categories_tenant_slug_key
  on public.menu_categories (tenant_id, slug);
create index menu_categories_tenant_sort_idx
  on public.menu_categories (tenant_id, sort_order, id);

create trigger menu_categories_set_updated_at
  before update on public.menu_categories
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------
create table public.menu_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  category_id        uuid references public.menu_categories(id) on delete set null,

  name               text not null,
  slug               text not null,
  description        text,
  -- Supabase Storage object path: <tenant_id>/menu-items/<uuid>.<ext>
  image_path         text,
  price_cents        integer not null,
  compare_at_cents   integer,
  cost_cents         integer,
  sku                text,

  is_available       boolean not null default true,
  is_featured        boolean not null default false,
  is_taxable         boolean not null default true,
  is_alcohol         boolean not null default false,
  sort_order         integer not null default 0,

  calories           integer,
  prep_time_mins     integer,
  spice_level        smallint,
  -- Free-form allergen/diet labels rendered on the storefront
  dietary_tags       text[] not null default '{}',
  allergens          text[] not null default '{}',

  -- Inventory: null = untracked
  stock_quantity     integer,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint menu_items_name_chk        check (length(btrim(name)) between 1 and 160),
  constraint menu_items_slug_chk        check (slug ~ '^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$'),
  constraint menu_items_price_chk       check (price_cents >= 0 and price_cents <= 1000000),
  constraint menu_items_compare_chk     check (compare_at_cents is null or compare_at_cents >= price_cents),
  constraint menu_items_cost_chk        check (cost_cents is null or cost_cents >= 0),
  constraint menu_items_calories_chk    check (calories is null or calories >= 0),
  constraint menu_items_prep_chk        check (prep_time_mins is null or prep_time_mins between 0 and 240),
  constraint menu_items_spice_chk       check (spice_level is null or spice_level between 0 and 5),
  constraint menu_items_stock_chk       check (stock_quantity is null or stock_quantity >= 0),
  constraint menu_items_image_path_chk  check (image_path is null or image_path like '%/menu-items/%')
);

create unique index menu_items_tenant_slug_key on public.menu_items (tenant_id, slug);
create index menu_items_tenant_category_sort_idx
  on public.menu_items (tenant_id, category_id, sort_order, id);
create index menu_items_tenant_available_idx
  on public.menu_items (tenant_id) where is_available;
create unique index menu_items_id_tenant_key on public.menu_items (id, tenant_id);

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.fn_set_updated_at();

-- A category may only be attached to an item of the same tenant. A plain
-- FK cannot express this, so the composite unique below lets the FK carry
-- tenant_id as part of the reference.
create unique index menu_categories_id_tenant_key
  on public.menu_categories (id, tenant_id);

alter table public.menu_items
  add constraint menu_items_category_same_tenant_fk
  foreign key (category_id, tenant_id)
  references public.menu_categories (id, tenant_id)
  on delete set null;

-- ---------------------------------------------------------------------
-- menu_modifier_groups
-- "Choose a size", "Add toppings (max 4)".
-- ---------------------------------------------------------------------
create table public.menu_modifier_groups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  description     text,
  selection_type  public.modifier_selection_type not null default 'single',
  is_required     boolean not null default false,
  min_selections  smallint not null default 0,
  max_selections  smallint,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint menu_modifier_groups_name_chk check (length(btrim(name)) between 1 and 120),
  constraint menu_modifier_groups_min_chk  check (min_selections >= 0),
  constraint menu_modifier_groups_max_chk
    check (max_selections is null or max_selections >= greatest(min_selections, 1)),
  constraint menu_modifier_groups_single_chk
    check (selection_type <> 'single' or coalesce(max_selections, 1) = 1),
  constraint menu_modifier_groups_required_chk
    check (is_required = false or min_selections >= 1)
);

create index menu_modifier_groups_tenant_idx
  on public.menu_modifier_groups (tenant_id, sort_order, id);
create unique index menu_modifier_groups_id_tenant_key
  on public.menu_modifier_groups (id, tenant_id);

create trigger menu_modifier_groups_set_updated_at
  before update on public.menu_modifier_groups
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- menu_modifiers
-- Individual selectable options inside a group.
-- ---------------------------------------------------------------------
create table public.menu_modifiers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  group_id           uuid not null,
  name               text not null,
  price_delta_cents  integer not null default 0,
  is_default         boolean not null default false,
  is_available       boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint menu_modifiers_name_chk  check (length(btrim(name)) between 1 and 120),
  constraint menu_modifiers_price_chk check (price_delta_cents between -100000 and 100000),
  constraint menu_modifiers_group_same_tenant_fk
    foreign key (group_id, tenant_id)
    references public.menu_modifier_groups (id, tenant_id) on delete cascade
);

create index menu_modifiers_group_idx on public.menu_modifiers (group_id, sort_order, id);
create index menu_modifiers_tenant_idx on public.menu_modifiers (tenant_id);
create unique index menu_modifiers_id_tenant_key on public.menu_modifiers (id, tenant_id);

create trigger menu_modifiers_set_updated_at
  before update on public.menu_modifiers
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- menu_item_modifier_groups
-- Many-to-many: groups are authored once and reused across items.
-- ---------------------------------------------------------------------
create table public.menu_item_modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  item_id     uuid not null,
  group_id    uuid not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint menu_item_modifier_groups_item_fk
    foreign key (item_id, tenant_id)
    references public.menu_items (id, tenant_id) on delete cascade,
  constraint menu_item_modifier_groups_group_fk
    foreign key (group_id, tenant_id)
    references public.menu_modifier_groups (id, tenant_id) on delete cascade
);

create unique index menu_item_modifier_groups_pair_key
  on public.menu_item_modifier_groups (item_id, group_id);
create index menu_item_modifier_groups_item_idx
  on public.menu_item_modifier_groups (item_id, sort_order);
