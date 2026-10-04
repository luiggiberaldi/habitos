-- 0041_mercado_marca_presentacion.sql
-- Luigi 2026-10-03: cada producto de Mercado lleva marca y presentación
-- (ej. Mayonesa, marca Mavesa, presentación 445gr — antes era 175gr).
-- La presentación puede cambiar con el tiempo sin crear otro producto:
-- es el mismo producto, otra presentación.

alter table public.mer_productos
  add column if not exists marca text
    check (marca is null or char_length(marca) between 1 and 40),
  add column if not exists presentacion text
    check (presentacion is null or char_length(presentacion) between 1 and 20);

-- ── rpc_mer_producto_upsert (0040 + p_marca / p_presentacion) ──
create or replace function public.rpc_mer_producto_upsert(
  p_user_id uuid,
  p_nombre text,
  p_unidad text,
  p_categoria text,
  p_precio_ref numeric default null,
  p_hogar_id uuid default null,
  p_stock_inicial numeric default null,
  p_marca text default null,
  p_presentacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_nuevo boolean := false;
  v_paso boolean := false;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  if p_nombre is null or char_length(trim(p_nombre)) = 0 then
    raise exception 'nombre_requerido';
  end if;
  if p_unidad not in ('und', 'kg', 'g', 'L', 'ml', 'paquete', 'caja') then
    raise exception 'unidad_invalida';
  end if;
  if p_categoria is null or char_length(trim(p_categoria)) = 0 then
    raise exception 'categoria_requerida';
  end if;
  if p_stock_inicial is not null and p_stock_inicial < 0 then
    raise exception 'stock_inicial_invalido';
  end if;

  select * into v_prod
  from public.mer_productos
  where user_id = p_user_id and lower(nombre) = lower(trim(p_nombre));

  if v_prod.id is null then
    insert into public.mer_productos
      (user_id, hogar_id, nombre, unidad, categoria, precio_referencia,
       marca, presentacion, creado_por)
    values
      (p_user_id, p_hogar_id, trim(p_nombre), p_unidad,
       lower(trim(p_categoria)), p_precio_ref,
       nullif(trim(coalesce(p_marca, '')), ''),
       nullif(trim(coalesce(p_presentacion, '')), ''), p_user_id)
    returning * into v_prod;
    v_nuevo := true;

    -- Stock inicial atómico: solo cuando el producto se crea (no en update).
    if p_stock_inicial is not null and p_stock_inicial > 0 then
      insert into public.mer_movimientos (producto_id, tipo, cantidad, nota, creado_por)
      values (v_prod.id, 'ajuste', p_stock_inicial, 'stock inicial', p_user_id);
    end if;
  else
    update public.mer_productos
    set unidad = p_unidad,
        categoria = lower(trim(p_categoria)),
        precio_referencia = coalesce(p_precio_ref, precio_referencia),
        marca = coalesce(nullif(trim(coalesce(p_marca, '')), ''), marca),
        presentacion = coalesce(nullif(trim(coalesce(p_presentacion, '')), ''), presentacion),
        hogar_id = coalesce(p_hogar_id, hogar_id),
        activo = true
    where id = v_prod.id
    returning * into v_prod;
  end if;

  -- 0040: el alta también pasa por el punto de reorden.
  v_paso := public.mer_pasar_a_lista_si_reorden(p_user_id, v_prod.id);

  return jsonb_build_object(
    'ok', true, 'id', v_prod.id, 'nombre', v_prod.nombre,
    'unidad', v_prod.unidad, 'categoria', v_prod.categoria,
    'marca', v_prod.marca, 'presentacion', v_prod.presentacion,
    'nuevo', v_nuevo, 'paso_a_lista', v_paso
  );
end;
$$;

-- ── rpc_mer_inventario (0037 + marca / presentacion en el select) ──
create or replace function public.rpc_mer_inventario(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return (
    with alcance as (
      select pr.*
      from public.mer_productos pr
      where pr.activo
        and (pr.user_id = p_user_id
          or (pr.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)))
    ),
    movs as (
      select m.*
      from public.mer_movimientos m
      join alcance a on a.id = m.producto_id
      where m.anulado_en is null
    ),
    stock as (
      select producto_id,
        sum(case when tipo = 'compra' then cantidad
                 when tipo = 'ajuste' then cantidad
                 else -cantidad end) as stock
      from movs group by producto_id
    ),
    compras as (
      select producto_id,
        (precio_total * tasa_usd) / nullif(cantidad, 0) as usd_unit,
        precio_total / nullif(cantidad, 0) as precio_unit,
        moneda, fecha, comercio, creado_en
      from movs where tipo = 'compra'
    ),
    stats as (
      select producto_id,
        min(usd_unit) as min_usd, max(usd_unit) as max_usd,
        avg(usd_unit) as prom_usd, count(*) as n_compras,
        (array_agg(usd_unit order by creado_en desc))[1] as ultimo_usd,
        (array_agg(precio_unit order by creado_en desc))[1] as ultimo_precio,
        (array_agg(moneda order by creado_en desc))[1] as ultima_moneda,
        (array_agg(comercio order by creado_en desc))[1] as ultimo_comercio
      from compras group by producto_id
    ),
    consumo as (
      select producto_id,
        sum(cantidad) / 30.0 as consumo_diario
      from movs
      where tipo = 'consumo' and fecha >= ((now() at time zone 'America/Caracas'))::date - 30
      group by producto_id
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.nombre), '[]'::jsonb)
    from (
      select b.*,
        round(b.diario, 3) as consumo_diario,
        round(b.diario * 30, 2) as consumo_mensual,
        case when b.diario > 0
          then floor(b.stock / b.diario)
        end as dias_agotamiento,
        case when b.diario > 0
          then (((now() at time zone 'America/Caracas'))::date
            + floor(b.stock / b.diario)::int)::text
        end as fecha_agotamiento,
        case when b.diario > 0
          then greatest(0, round(b.diario * b.horizonte_compra_dias - b.stock, 2))
        end as sugerido_comprar,
        (b.stock <= b.stock_minimo) as bajo_minimo
      from (
        select a.id, a.nombre, a.unidad, a.categoria,
          a.marca, a.presentacion,
          a.stock_minimo,
          coalesce(s.stock, 0) as stock,
          st.ultimo_precio as ultimo_precio,
          st.ultima_moneda as ultima_moneda,
          st.ultimo_comercio as ultimo_comercio,
          round(st.min_usd, 2) as precio_min_usd,
          round(st.max_usd, 2) as precio_max_usd,
          round(st.prom_usd, 2) as precio_prom_usd,
          round(st.ultimo_usd, 2) as precio_usd_unitario,
          case when st.prom_usd > 0
            then round((st.ultimo_usd - st.prom_usd) / st.prom_usd * 100, 1)
          end as variacion_pct,
          case
            when c.consumo_diario is not null then c.consumo_diario
            when a.consumo_semanal_estim is not null then a.consumo_semanal_estim / 7.0
          end as diario,
          (c.consumo_diario is null
            and a.consumo_semanal_estim is not null) as consumo_estimado,
          a.horizonte_compra_dias,
          a.consumo_semanal_estim,
          st.n_compras
        from alcance a
        left join stock s on s.producto_id = a.id
        left join stats st on st.producto_id = a.id
        left join consumo c on c.producto_id = a.id
      ) b
    ) t
  );
end;
$$;
