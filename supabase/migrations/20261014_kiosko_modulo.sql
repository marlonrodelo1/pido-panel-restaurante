-- Módulo KIOSKO (14 oct 2026): autopedido en una pantalla táctil del propio local.
--
-- Mismo contrato que el TPV, el Almacén y la IA del teléfono: lo ENCIENDE Pidoo
-- (`activo`, congelado para el dueño) y lo PAUSA el restaurante
-- (`pausado_por_restaurante`). Sin fila no hay módulo: la fila solo la siembra
-- `kiosko_activar`, que exige superadmin. No hay policy de INSERT para nadie más.
--
-- LOS PEDIDOS DEL KIOSKO NO SON UN ORIGEN NUEVO. Entran como `origen_pedido='mesa'`
-- + `para_llevar=true` + `kiosko=true`: la economía de "cliente dentro del local
-- que paga en la barra" ya está escrita y probada para la mesa (precio de barra,
-- comisión 0, sin pedido mínimo, nace aceptado, fuera del anti-duplicado y de
-- Telegram, gasta empaques si es para llevar). Un origen nuevo habría obligado a
-- tocar una docena de funciones de dinero; la marca `kiosko` es solo para que
-- el TPV y los informes sepan de qué puerta vino.

create table public.kiosko_config (
  establecimiento_id uuid primary key references public.establecimientos(id) on delete cascade,
  activo boolean not null default false,
  pausado_por_restaurante boolean not null default false,
  -- PIN de 4 cifras para que el PERSONAL pause el kiosko desde la propia pantalla
  -- (5 toques en la esquina). No protege dinero: solo esconde el menú de pausa.
  pin_personal text not null default '1234' check (pin_personal ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.kiosko_config is
  'Módulo Kiosko (autopedido en pantalla del local). activo lo pone Pidoo (PD350); el dueño pausa y cambia el PIN.';

alter table public.kiosko_config enable row level security;
revoke all on public.kiosko_config from anon;

create policy kiosko_config_select on public.kiosko_config
  for select to authenticated
  using (public._user_owns_establecimiento(establecimiento_id) or public.is_superadmin());

create policy kiosko_config_update_dueno on public.kiosko_config
  for update to authenticated
  using (public._user_owns_establecimiento(establecimiento_id) or public.is_superadmin())
  with check (public._user_owns_establecimiento(establecimiento_id) or public.is_superadmin());

create policy superadmin_full_kiosko_config on public.kiosko_config
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create or replace function public.kiosko_config_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if public._ctx_is_trusted_writer() or public.is_superadmin() then
    new.updated_at := now();
    return new;
  end if;

  if new.activo is distinct from old.activo then
    raise exception 'El kiosko lo activa Pidoo. Tú puedes pausarlo cuando quieras desde el panel.'
      using errcode = 'PD350';
  end if;

  if new.establecimiento_id is distinct from old.establecimiento_id then
    raise exception 'No puedes mover la configuración del kiosko a otro restaurante.'
      using errcode = 'PD351';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

create trigger trg_kiosko_config_guard
  before update on public.kiosko_config
  for each row execute function public.kiosko_config_guard();

-- Enciende o apaga el módulo. SIEMBRA la fila: que exista la fila es tener el módulo.
create or replace function public.kiosko_activar(p_establecimiento_id uuid, p_activo boolean)
returns public.kiosko_config
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_fila public.kiosko_config;
begin
  if not public.is_superadmin() then
    raise exception 'Solo Pidoo puede activar el kiosko de un restaurante.' using errcode = 'PD352';
  end if;
  insert into public.kiosko_config (establecimiento_id, activo)
  values (p_establecimiento_id, p_activo)
  on conflict (establecimiento_id) do update
    set activo = excluded.activo, updated_at = now()
  returning * into v_fila;
  return v_fila;
end
$function$;

revoke execute on function public.kiosko_activar(uuid, boolean) from public, anon;
grant execute on function public.kiosko_activar(uuid, boolean) to authenticated;

-- La marca de puerta. Solo la escribe la edge `kiosko-pedido` (service_role); un
-- cliente que la pusiera a mano en un pedido normal no gana nada: el origen lo
-- sigue fijando `trg_00_blindar_origen_pedido`, y el TPV solo trata como kiosko
-- lo que es `origen_pedido='mesa'` y además lleva la marca.
alter table public.pedidos add column kiosko boolean not null default false;

comment on column public.pedidos.kiosko is
  'Pedido hecho en el kiosko de autopedido del local (va como origen mesa + para_llevar).';
