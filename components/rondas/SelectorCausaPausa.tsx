'use client'

// El selector de causa de pausa. Uno solo, para las dos pantallas que pausan.
//
// Existe como componente y no como dos <select> porque lo que importa acá no es
// el control: es el texto que explica qué implica cada opción. Si esa
// explicación estuviera escrita dos veces, tarde o temprano una de las dos
// diría algo distinto sobre la misma elección — y la elección decide si las
// rondas de alguien se cuentan como no realizadas.

import { OPCIONES_CAUSA } from '@/lib/rondas-causas'
import type { CausaPausa } from '@/lib/rondas-causas'

const S = {
  label:  { display:'block', fontSize:11.5, color:'#94a3b8', marginBottom:4, letterSpacing:.3 },
  select: { width:'100%', background:'#0b1220', border:'1px solid #334155', color:'#e2e8f0',
            borderRadius:8, padding:'8px 10px', fontSize:13 },
  ayuda:  { fontSize:11.5, lineHeight:1.5, marginTop:6, color:'#94a3b8' },
  alerta: { fontSize:11.5, lineHeight:1.5, marginTop:6, color:'#fbbf24' },
}

interface Props {
  valor: CausaPausa | ''
  onCambio: (c: CausaPausa | '') => void
  disabled?: boolean
}

export default function SelectorCausaPausa({ valor, onCambio, disabled }: Props) {
  const elegida = OPCIONES_CAUSA.find(o => o.clave === valor)
  // La única que le suma incumplimientos a una persona se avisa en otro color.
  // Elegirla sin darse cuenta es el error caro de esta pantalla.
  const acusa = valor === 'no_se_realiza'

  return (
    <div style={{ marginTop: 10 }}>
      <label style={S.label} htmlFor="causa-pausa">Causa de la pausa *</label>
      <select
        id="causa-pausa"
        value={valor}
        disabled={disabled}
        onChange={e => onCambio(e.target.value as CausaPausa | '')}
        style={S.select}
      >
        <option value="">Elegí por qué se pausa…</option>
        {OPCIONES_CAUSA.map(o => (
          <option key={o.clave} value={o.clave}>{o.etiqueta}</option>
        ))}
      </select>

      {elegida
        ? <div style={acusa ? S.alerta : S.ayuda}>{elegida.ayuda}</div>
        : (
          <div style={S.ayuda}>
            De esto depende si las rondas de este período se le cuentan al vigilador
            o salen del cálculo. El motivo de abajo lo explica para una persona;
            la causa es el dato con el que se mide.
          </div>
        )}
    </div>
  )
}
