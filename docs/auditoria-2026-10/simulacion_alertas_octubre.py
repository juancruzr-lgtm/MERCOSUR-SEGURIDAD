# Simulación de las reglas nuevas de alertas de ronda sobre octubre 2026.
# Ver docs/auditoria-2026-10/simulacion_alertas_octubre.md (consultas de sólo
# lectura y cómo correrlo). Entrada: respuestas JSON del MCP de Supabase.
import json, re, sys
from datetime import datetime, timedelta, timezone
from collections import defaultdict, Counter

def cargar(ruta):
    t = open(ruta).read()
    obj = json.loads(t)['result']
    i = obj.index('\n[') + 1
    j = obj.rindex(']\n</untrusted') + 1
    return json.loads(obj[i:j])[0]

def ts(s):
    if s is None: return None
    s = s.replace('Z', '+00:00')
    m = re.match(r'(.*\.\d{1,6})(\d*)([+-]\d\d:\d\d)$', s)
    if m: s = m.group(1) + m.group(3)
    return datetime.fromisoformat(s)

alertas = cargar(sys.argv[1])['json_agg']
notif = cargar(sys.argv[2])['r']
AR = timezone(timedelta(hours=-3))
H2 = timedelta(hours=2)

for a in alertas:
    for k in ('vi', 've', 'da', 'ra', 'pi'):
        a[k] = ts(a[k])
    a['ej'] = [ts(x) for x in (a['ej'] or [])]
porid = {a['id']: a for a in alertas}

# ── 1) Episodios y cierre automático ─────────────────────────────────────────
grupos = defaultdict(list)
for a in alertas:
    if a['tipo'] in ('no_iniciada', 'no_finalizada'):
        grupos[(a['rb'], a['t'])].append(a)
episodios = []
agrupada = {}       # id alerta → id alerta del episodio (si se habría agrupado)
for clave, lista in grupos.items():
    lista.sort(key=lambda a: a['vi'])
    ep = None
    for x in lista:
        if ep is not None:
            primera = ep['alertas'][0]
            # Cierre automático: episodio de 1 ventana con ejecución posterior en el turno,
            # ocurrida antes de detectar esta ventana.
            auto = len(ep['alertas']) == 1 and any(e >= primera['vi'] and e < x['da'] for e in primera['ej'])
            # Conservador: un cierre manual previo (sin resultado conocido) abre episodio nuevo.
            manual = primera['estado'] == 'resuelta' and primera['ra'] is not None and primera['ra'] < x['da']
            if not auto and not manual:
                ep['alertas'].append(x)
                agrupada[x['id']] = primera['id']
                continue
        ep = {'alertas': [x]}
        episodios.append(ep)

def auto_cierra(ep):
    p = ep['alertas'][0]
    return len(ep['alertas']) == 1 and p['tipo'] == 'no_iniciada' and any(e >= p['vi'] for e in p['ej'])

n_inc = sum(len(l) for l in grupos.values())
auto = [ep for ep in episodios if auto_cierra(ep)]
auto_pend = [ep for ep in auto if ep['alertas'][0]['estado'] == 'pendiente']
pend_hist = sum(1 for a in alertas if a['estado'] == 'pendiente')
pend_nuevo = sum(1 for ep in episodios if ep['alertas'][0]['estado'] == 'pendiente' and not auto_cierra(ep)) \
    + sum(1 for a in alertas if a['tipo'] == 'suspendida' and a['estado'] == 'pendiente')
res = {
    'alertas_total': len(alertas),
    'alertas_incumplimiento': n_inc,
    'episodios': len(episodios),
    'alertas_evitadas_por_episodio': len(agrupada),
    'episodios_con_varias_ventanas': sum(1 for e in episodios if len(e['alertas']) > 1),
    'max_ventanas_episodio': max(len(e['alertas']) for e in episodios),
    'episodios_cierre_automatico': len(auto),
    'de_ellos_hoy_pendientes': len(auto_pend),
    'pendientes_hoy': pend_hist,
    'pendientes_con_reglas_nuevas': pend_nuevo,
}

# ── 2) Push a supervisores ───────────────────────────────────────────────────
push = [(u, t, ts(c)) for u, t, c in (notif['push'] or [])]
p_cnt = Counter()
quedan = []
for u, tipo, c in push:
    aid = tipo.split(':', 1)[1]
    a = porid.get(aid)
    if a is None: p_cnt['alerta_fuera_de_octubre'] += 1; quedan.append((u, c, None)); continue
    if aid in agrupada: p_cnt['evitado_episodio'] += 1; continue
    if a['pi'] is not None and a['pi'] < c: p_cnt['evitado_intervenida'] += 1; continue
    if c - a['da'] > H2: p_cnt['vieja_a_resumen'] += 1; quedan.append((u, c, 'resumen')); continue
    quedan.append((u, c, 'individual'))
# Tope diario 20 por supervisor (individuales) y resúmenes (1 por usuario y bloque de 6 h).
por_dia = Counter(); resumenes = set(); individuales = 0; tope = 0
for u, c, kind in sorted(quedan, key=lambda x: x[1]):
    d = c.astimezone(AR)
    if kind == 'resumen':
        resumenes.add((u, d.date(), d.hour // 6)); continue
    if por_dia[(u, d.date())] >= 20:
        tope += 1; resumenes.add((u, d.date(), d.hour // 6)); continue
    por_dia[(u, d.date())] += 1; individuales += 1
res['push'] = {
    'enviados_octubre': len(push), **p_cnt,
    'cortados_por_tope_diario': tope,
    'individuales_con_reglas_nuevas': individuales,
    'resumenes_en_su_lugar': len(resumenes),
    'total_con_reglas_nuevas': individuales + len(resumenes),
    'atrasados_mas_2h_hoy': sum(1 for u, t, c in push if porid.get(t.split(':', 1)[1]) and c - porid[t.split(':', 1)[1]]['da'] > H2),
    'max_atraso_horas': round(max(((c - porid[t.split(':', 1)[1]]['da']).total_seconds() / 3600) for u, t, c in push if porid.get(t.split(':', 1)[1])), 1),
}

# ── 3) WhatsApp a supervisores (rondas) ──────────────────────────────────────
wa = [(u, aid, ts(c)) for u, aid, c in (notif['wa'] or [])]
w_cnt = Counter(); por_dia = Counter(); w_ok = 0
for u, aid, c in sorted(wa, key=lambda x: x[2]):
    a = porid.get(aid)
    if a is None: w_cnt['alerta_fuera_de_octubre'] += 1
    elif aid in agrupada: w_cnt['evitado_episodio'] += 1; continue
    elif a['pi'] is not None and a['pi'] < c: w_cnt['evitado_intervenida'] += 1; continue
    elif c - a['da'] > H2: w_cnt['evitado_vieja'] += 1; continue
    d = c.astimezone(AR).date()
    if por_dia[(u, d)] >= 15: w_cnt['evitado_tope_diario'] += 1; continue
    por_dia[(u, d)] += 1; w_ok += 1
varios = notif['varios'] or []
res['whatsapp_supervisores'] = {
    'enviados_registrados_octubre': len(wa), **w_cnt, 'con_reglas_nuevas': w_ok,
    'dias_con_mas_de_15_a_un_supervisor': sum(1 for v in Counter((u, c.astimezone(AR).date()) for u, _, c in wa).values() if v > 15),
    'varios_sin_guardia_intentos': sum(v[1] for v in varios),
    'varios_sin_guardia_alertas': len(varios),
    'varios_sin_guardia_con_reglas_nuevas': len(varios),
}

# ── 4) Recordatorios al vigilador ────────────────────────────────────────────
silencio = {}
for a in alertas:
    if a['tipo'] not in ('no_iniciada', 'no_finalizada') or a['pi'] is None: continue
    k = (a['rb'], a['t'])
    silencio[k] = min(silencio.get(k, a['pi']), a['pi'])
vig = [(k, rb, t, ts(c)) for k, rb, t, c in (notif['vig'] or [])]
v_cnt = Counter(); v_tot = Counter()
for kind, rb, t, c in vig:
    v_tot[kind] += 1
    s = silencio.get((rb, t))
    if s is not None and c > s: v_cnt[kind] += 1
res['recordatorios_vigilador'] = {'enviados': dict(v_tot), 'evitados_por_intervencion': dict(v_cnt)}

print(json.dumps(res, indent=2, ensure_ascii=False, default=str))
