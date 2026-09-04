// Política de privacidad.
//
// Página estática y pública, exigida por Meta para publicar la app de WhatsApp
// Business (la Cloud API no deja pasar una app a producción sin una URL de
// política de privacidad accesible). Describe el ÚNICO uso de datos del canal:
// notificaciones operativas salientes a personal de Mercosur Seguridad. No es
// una app de consumidores ni recopila datos de terceros.
//
// Se renderiza en el servidor (sin 'use client') para que sea HTML estático,
// indexable y accesible sin sesión, que es lo que Meta valida.

export const metadata = {
  title: 'Política de Privacidad — Mercosur Seguridad',
  description: 'Política de privacidad del canal de notificaciones operativas de Mercosur Seguridad SRL.',
}

export const dynamic = 'force-static'

const ACTUALIZADO = '4 de septiembre de 2026'

export default function PoliticaPrivacidad() {
  return (
    <main style={{
      maxWidth: 820, margin: '0 auto', padding: '48px 24px 96px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      color: '#1e293b', lineHeight: 1.65, background: '#fff',
    }}>
      <h1 style={{ fontSize: 30, marginBottom: 4 }}>Política de Privacidad</h1>
      <p style={{ color: '#64748b', marginTop: 0 }}>
        Mercosur Seguridad SRL — última actualización: {ACTUALIZADO}
      </p>

      <section>
        <h2>Quiénes somos</h2>
        <p>
          Esta política corresponde a <strong>Mercosur Seguridad SRL</strong>, empresa de
          seguridad privada con domicilio en Mejico 1329, Rosario, Santa Fe, Argentina, y a
          su sistema interno de gestión operativa (en adelante, “el Sistema”). Contacto:{' '}
          <a href="mailto:info@mercosurseguridad.com.ar">info@mercosurseguridad.com.ar</a>.
        </p>
      </section>

      <section>
        <h2>Alcance de este canal de WhatsApp</h2>
        <p>
          El Sistema utiliza la API de WhatsApp Business únicamente para <strong>enviar
          notificaciones operativas salientes</strong> al personal propio de la empresa
          (supervisores, personal jerárquico y, eventualmente, vigiladores). Ejemplos:
          aviso de un puesto sin cobertura confirmada, un turno sin registro de ingreso o
          una ronda programada que no fue iniciada.
        </p>
        <p>
          Este canal <strong>no está dirigido al público</strong> ni a clientes, y{' '}
          <strong>no procesa mensajes entrantes</strong> de personas con fines
          comerciales dentro del Sistema.
        </p>
      </section>

      <section>
        <h2>Qué datos se utilizan</h2>
        <ul>
          <li><strong>Número de teléfono</strong> del personal, cargado por la propia empresa en su legajo interno, para poder entregar la notificación.</li>
          <li><strong>Nombre y rol operativo</strong> de la persona, para dirigir el aviso correcto a la persona responsable.</li>
          <li><strong>Datos del evento operativo</strong> que motiva el aviso (objetivo, puesto, horario, estado del turno o de la ronda).</li>
        </ul>
        <p>
          No se recopilan datos de personas ajenas a la empresa a través de este canal, ni
          se solicitan datos financieros, credenciales ni información sensible por WhatsApp.
        </p>
      </section>

      <section>
        <h2>Para qué se usan</h2>
        <p>
          Los datos se usan con el único fin de <strong>coordinar la operación de
          seguridad</strong>: avisar a la persona responsable cuando un servicio requiere
          su intervención. No se usan para publicidad, no se venden ni se ceden a terceros,
          y no se emplean para tomar decisiones laborales automatizadas.
        </p>
      </section>

      <section>
        <h2>Con quién se comparten</h2>
        <p>
          Para entregar los mensajes, los datos estrictamente necesarios se transmiten a{' '}
          <strong>Meta Platforms, Inc.</strong> como proveedor de la API de WhatsApp
          Business, sujeto a sus propias políticas. No se comparten con ningún otro tercero.
        </p>
      </section>

      <section>
        <h2>Conservación y seguridad</h2>
        <p>
          Los teléfonos del personal se conservan mientras dure la relación laboral y la
          necesidad operativa. Se registra una auditoría de los avisos enviados (fecha,
          destinatario, resultado) con fines de trazabilidad interna. Las credenciales de
          acceso a la API se almacenan como secretos de servidor y nunca se exponen.
        </p>
      </section>

      <section>
        <h2>Derechos del personal</h2>
        <p>
          Cualquier integrante del personal puede solicitar acceder, corregir o suprimir su
          número de teléfono, o dejar de recibir estas notificaciones, comunicándose con la
          administración de la empresa o escribiendo a{' '}
          <a href="mailto:info@mercosurseguridad.com.ar">info@mercosurseguridad.com.ar</a>.
        </p>
      </section>

      <section>
        <h2>Cambios</h2>
        <p>
          Esta política puede actualizarse para reflejar cambios operativos o legales. La
          fecha de última actualización figura al inicio.
        </p>
      </section>
    </main>
  )
}
