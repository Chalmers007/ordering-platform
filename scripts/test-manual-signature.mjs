import crypto from 'crypto'

// Create a valid signed request
const secret = 'ssssssssssssssssssssssssssssssssssssssss'
const keyId = 'test-key'

const body = JSON.stringify({ test: 'data' })
const bodyHash = crypto.createHash('sha256').update(body).digest('hex')

const timestamp = Math.floor(Date.now() / 1000).toString()
const nonce = crypto.randomBytes(24).toString('base64url')

const canonical = ['v1', 'raven', timestamp, nonce, keyId, 'POST', '/api/internal/provision/raven', bodyHash].join('\n')
const signature = crypto.createHmac('sha256', secret).update(canonical).digest('base64url')

console.log('=== Manual signature test ===')
console.log('Canonical:', canonical.replace(/\n/g, '\\n'))
console.log('Signature:', signature)
