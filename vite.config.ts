import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync, execFileSync } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function runDjango(pyScript: string): string {
  const out = execFileSync(
    'docker',
    ['exec', 'weblate', '/app/venv/bin/weblate', 'shell', '-c', pyScript],
    { encoding: 'utf-8' }
  ).trim()
  // Django management command may emit noise before our print(); take last line
  return out.split('\n').filter(Boolean).pop() ?? '[]'
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'weblate-auth',
      configureServer(server) {
        // token → username map for suggestion attribution (POC: in-memory only)
        const userMap = new Map<string, string>()

        server.middlewares.use('/auth/login', async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }

          try {
            const { username, password } = JSON.parse(await readBody(req))

            // Validate credentials server-side via Weblate session login
            const r1 = await fetch('http://localhost:8080/accounts/login/')
            const html = await r1.text()
            const csrf = html.match(/csrfmiddlewaretoken[^>]*value="([^"]+)"/)?.[1]
            const sessionCookie = r1.headers.get('set-cookie')?.split(';')[0] ?? ''

            if (!csrf) throw new Error('CSRF not found')

            const r2 = await fetch('http://localhost:8080/accounts/login/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': sessionCookie,
              },
              redirect: 'manual',
              body: new URLSearchParams({ username, password, csrfmiddlewaretoken: csrf }).toString(),
            })

            if (r2.status !== 302) {
              res.statusCode = 401
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Identifiants incorrects' }))
              return
            }

            // Get or create user's API token via management command
            let token: string | null = null
            try {
              const out = execSync(
                `docker exec weblate /app/venv/bin/weblate drf_create_token "${username}" 2>&1`
              ).toString()
              token = out.match(/Generated token (\S+)/)?.[1] ?? null
            } catch { /* token already exists */ }

            if (!token) {
              const out = execSync(
                `docker exec weblate /app/venv/bin/weblate shell -c ` +
                `"from weblate.auth.models import User; u=User.objects.get(username='${username}'); print(u.auth_token.key)" 2>&1`
              ).toString()
              token = out.trim().split('\n').pop() ?? null
            }

            if (!token) throw new Error('Could not get API token')

            userMap.set(token, username)

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ token, username }))
          } catch (e) {
            const isAuth = String(e).includes('401') || String(e).includes('Invalid')
            res.statusCode = isAuth ? 401 : 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(e) }))
          }
        })

        server.middlewares.use('/suggestions', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const subPath = (req.url ?? '/').split('?')[0]
          const token = (req.headers.authorization ?? '').replace('Token ', '')
          const username = userMap.get(token) ?? ''

          const sendJson = (data: unknown, status = 200) => {
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          }

          try {
            // GET /suggestions/:unitId — list suggestions for a unit
            if (req.method === 'GET') {
              const unitId = subPath.replace('/', '')
              if (!/^\d+$/.test(unitId)) { next(); return }

              const args = Buffer.from(JSON.stringify({ unitId: +unitId, username })).toString('base64')
              const out = runDjango(`
import json, base64
args = json.loads(base64.b64decode('${args}').decode())
from weblate.trans.models.suggestion import Suggestion, Vote
from weblate.auth.models import User
from django.db.models import Sum

try:
    current_user = User.objects.get(username=args['username'])
except Exception:
    current_user = None

subs = Suggestion.objects.filter(unit_id=args['unitId']).select_related('user')
result = []
for s in subs:
    v = s.vote_set.aggregate(Sum('value'))['value__sum'] or 0
    user_vote = None
    if current_user:
        uv = s.vote_set.filter(user=current_user).first()
        user_vote = uv.value if uv else None
    result.append({'id': s.id, 'target': s.target, 'user': s.user.username if s.user else None, 'timestamp': str(s.timestamp), 'num_votes': v, 'user_vote': user_vote})
result.sort(key=lambda x: -x['num_votes'])
print(json.dumps(result))
`)
              sendJson(JSON.parse(out))
              return
            }

            if (req.method === 'POST') {
              const body = JSON.parse(await readBody(req))

              // POST /suggestions/:suggestionId/vote — vote on a suggestion
              const voteMatch = subPath.match(/^\/(\d+)\/vote$/)
              if (voteMatch) {
                const suggestionId = +voteMatch[1]
                const value: 1 | -1 = body.value === 1 ? 1 : -1
                const args = Buffer.from(JSON.stringify({ suggestionId, username, value })).toString('base64')
                const out = runDjango(`
import json, base64
args = json.loads(base64.b64decode('${args}').decode())
from weblate.trans.models.suggestion import Suggestion, Vote
from weblate.auth.models import User
from django.db.models import Sum

s = Suggestion.objects.get(id=args['suggestionId'])
u = User.objects.get(username=args['username'])
value = args['value']

vote, created = Vote.objects.get_or_create(suggestion=s, user=u)
if not created and vote.value == value:
    vote.delete()
    user_vote = None
else:
    vote.value = value
    vote.save()
    user_vote = value

num_votes = s.vote_set.aggregate(Sum('value'))['value__sum'] or 0
print(json.dumps({'id': s.id, 'num_votes': num_votes, 'user_vote': user_vote}))
`)
                sendJson(JSON.parse(out))
                return
              }

              // POST /suggestions/:unitId — create a suggestion
              const createMatch = subPath.match(/^\/(\d+)$/)
              if (createMatch) {
                const unitId = +createMatch[1]
                const args = Buffer.from(JSON.stringify({ unitId, username, target: body.target })).toString('base64')
                const out = runDjango(`
import json, base64
args = json.loads(base64.b64decode('${args}').decode())
from weblate.trans.models.suggestion import Suggestion
from weblate.trans.models import Unit
from weblate.auth.models import User

unit = Unit.objects.get(id=args['unitId'])
user = User.objects.get(username=args['username'])
target = args['target']

existing = Suggestion.objects.filter(unit=unit, target=target).first()
if existing:
    print(json.dumps({'id': existing.id, 'target': existing.target, 'user': existing.user.username if existing.user else None, 'timestamp': str(existing.timestamp), 'num_votes': 0, 'user_vote': None}))
else:
    s = Suggestion.objects.create(unit=unit, target=target, user=user)
    print(json.dumps({'id': s.id, 'target': s.target, 'user': args['username'], 'timestamp': str(s.timestamp), 'num_votes': 0, 'user_vote': None}))
`)
                sendJson(JSON.parse(out), 201)
                return
              }
            }

            // PATCH /suggestions/:suggestionId — edit own suggestion
            if (req.method === 'PATCH') {
              const body = JSON.parse(await readBody(req))
              const patchMatch = subPath.match(/^\/(\d+)$/)
              if (patchMatch) {
                const suggestionId = +patchMatch[1]
                const args = Buffer.from(JSON.stringify({ suggestionId, username, target: body.target })).toString('base64')
                const out = runDjango(`
import json, base64
args = json.loads(base64.b64decode('${args}').decode())
from weblate.trans.models.suggestion import Suggestion, Vote
from django.db.models import Sum

s = Suggestion.objects.get(id=args['suggestionId'])
if s.user and s.user.username != args['username']:
    print(json.dumps({'error': 'Not authorized'}))
else:
    s.target = args['target']
    s.save()
    num_votes = s.vote_set.aggregate(Sum('value'))['value__sum'] or 0
    uv = s.vote_set.filter(user__username=args['username']).first()
    print(json.dumps({'id': s.id, 'target': s.target, 'user': s.user.username if s.user else None, 'timestamp': str(s.timestamp), 'num_votes': num_votes, 'user_vote': uv.value if uv else None}))
`)
                const parsed = JSON.parse(out)
                if (parsed.error) { sendJson(parsed, 403); return }
                sendJson(parsed)
                return
              }
            }

            next()
          } catch (e) {
            sendJson({ error: String(e) }, 500)
          }
        })
      },
    },
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
