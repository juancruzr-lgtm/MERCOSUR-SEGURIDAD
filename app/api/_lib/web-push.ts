import crypto from 'crypto'

export type PushSubscriptionRow = {
  id: string
  usuario_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

function base64UrlToBuffer(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  return Buffer.from((value + padding).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function bufferToBase64Url(value: Buffer) {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function hkdf(secret: Buffer, salt: Buffer, info: Buffer, length: number) {
  const prk = crypto.createHmac('sha256', salt).update(secret).digest()
  let previous = Buffer.alloc(0)
  let output = Buffer.alloc(0)
  let counter = 1

  while (output.length < length) {
    previous = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest()
    output = Buffer.concat([output, previous])
    counter += 1
  }

  return output.subarray(0, length)
}

function pushAudience(endpoint: string) {
  const url = new URL(endpoint)
  return `${url.protocol}//${url.host}`
}

function vapidAuthorization(endpoint: string) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey) throw new Error('Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  if (!privateKey) throw new Error('Falta VAPID_PRIVATE_KEY')
  if (!subject) throw new Error('Falta VAPID_SUBJECT')

  const publicBuffer = base64UrlToBuffer(publicKey)
  const privateBuffer = base64UrlToBuffer(privateKey)
  if (publicBuffer.length !== 65 || publicBuffer[0] !== 4) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY inválida')

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bufferToBase64Url(publicBuffer.subarray(1, 33)),
    y: bufferToBase64Url(publicBuffer.subarray(33, 65)),
    d: bufferToBase64Url(privateBuffer),
  }
  const header = bufferToBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bufferToBase64Url(Buffer.from(JSON.stringify({
    aud: pushAudience(endpoint),
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })))
  const signingInput = `${header}.${claims}`
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' })
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  })

  return `vapid t=${signingInput}.${bufferToBase64Url(signature)}, k=${publicKey}`
}

function encryptPayload(subscription: PushSubscriptionRow, payload: PushPayload) {
  const receiverPublicKey = base64UrlToBuffer(subscription.p256dh)
  const authSecret = base64UrlToBuffer(subscription.auth)
  const salt = crypto.randomBytes(16)
  const localKey = crypto.createECDH('prime256v1')
  const localPublicKey = localKey.generateKeys()
  const sharedSecret = localKey.computeSecret(receiverPublicKey)

  const ikm = hkdf(
    sharedSecret,
    authSecret,
    Buffer.concat([
      Buffer.from('WebPush: info\0', 'utf8'),
      receiverPublicKey,
      localPublicKey,
    ]),
    32,
  )
  const contentEncryptionKey = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const record = Buffer.concat([body, Buffer.from([2])])
  const cipher = crypto.createCipheriv('aes-128-gcm', contentEncryptionKey, nonce)
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)

  salt.copy(header, 0)
  header.writeUInt32BE(4096, 16)
  header.writeUInt8(localPublicKey.length, 20)

  return Buffer.concat([header, localPublicKey, encrypted])
}

export async function sendWebPush(subscription: PushSubscriptionRow, payload: PushPayload) {
  const encrypted = encryptPayload(subscription, payload)
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: vapidAuthorization(subscription.endpoint),
    },
    body: encrypted,
  })

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const text = await response.text().catch(() => '')
    throw new Error(`Push falló ${response.status}: ${text || response.statusText}`)
  }

  return response
}
