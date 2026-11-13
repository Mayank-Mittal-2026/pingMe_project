import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import societyRouter from './society.js'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null

let queue = 0
let location = { lat: 12.968, lng: 77.594, updatedAt: new Date().toISOString() }
let trip = { active: true, mode: 'demo', startedAt: new Date().toISOString() }
let pickups = []

const students = [
  { id: '22222222-2222-4222-8222-222222222221', name: 'Maya Chen', grade: 'Grade 4 · Class B', parentName: 'Alex Chen' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Leo Chen', grade: 'Grade 1 · Class A', parentName: 'Alex Chen' }
]

const route = [
  [12.963, 77.585],
  [12.966, 77.589],
  [12.968, 77.594],
  [12.971, 77.598],
  [12.974, 77.602],
  [12.978, 77.604]
]

let step = 2
setInterval(() => {
  if (trip.active && trip.mode === 'demo') {
    step = (step + 1) % route.length
    location = { lat: route[step][0], lng: route[step][1], updatedAt: new Date().toISOString() }
  }
}, 3500)

async function auth(req, res, next) {
  if (!supabase) {
    req.profile = { id: 'demo-user', role: req.headers['x-demo-role'] || 'parent', school_id: 'demo-school' }
    return next()
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  req.user = data.user
  req.sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const { data: profile } = await req.sb.from('profiles').select('id,role,school_id').eq('id', data.user.id).single()
  if (!profile) return res.status(403).json({ error: 'Your school profile is not set up yet.' })
  req.profile = profile
  next()
}

app.get('/api/health', (_req, res) => res.json({ ok: true, mode: supabase ? 'supabase' : 'demo' }))
// Society has its own residents, guards, and admin role model, separate from school profiles.
app.use('/api/society', societyRouter)
app.use('/api', auth)

app.get('/api/dashboard', async (req, res) => {
  if (supabase) {
    try {
      const profile = req.profile
      const [st, ps, tripRows, locRows, pickRows] = await Promise.all([
        req.sb.from('students').select('id', { count: 'exact', head: true }).eq('school_id', profile.school_id),
        req.sb.from('parent_student_relationships').select('student_id').eq('parent_id', profile.id),
        req.sb.from('trips').select('*').eq('school_id', profile.school_id).eq('status', 'active').order('started_at', { ascending: false }).limit(1),
        req.sb.from('bus_locations').select('*').eq('school_id', profile.school_id).order('recorded_at', { ascending: false }).limit(1),
        req.sb.from('pickup_requests').select('id,student_id,queue_number,status,created_at,students(full_name,grade)').eq('school_id', profile.school_id).neq('status', 'Handed Over').order('queue_number')
      ])
      if (pickRows.error) throw pickRows.error
      const ids = (ps.data || []).map(x => x.student_id)
      let filtered = pickRows.data || []
      if (profile.role === 'parent') filtered = filtered.filter(x => ids.includes(x.student_id))
      return res.json({
        pickups: filtered.map((p, i) => ({
          position: i + 1,
          id: p.id,
          studentId: p.student_id,
          studentName: p.students?.full_name,
          grade: p.students?.grade,
          queueNumber: p.queue_number,
          status: p.status,
          arrivalTime: new Date(p.created_at).toLocaleTimeString()
        })),
        trip: tripRows.data?.[0] ? { active: true, mode: 'real' } : { active: false },
        location: locRows.data?.[0] ? { lat: Number(locRows.data[0].latitude), lng: Number(locRows.data[0].longitude) } : null,
        stats: { students: st.count, buses: 8, drivers: 8, activeTrips: tripRows.data?.length || 0 }
      })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  const relevant = req.profile?.role === 'parent'
    ? pickups.filter(p => p.studentId === '22222222-2222-4222-8222-222222222221' || p.studentId === '22222222-2222-4222-8222-222222222222')
    : pickups
  res.json({
    pickups: relevant.map((p, i) => ({
      ...p,
      position: relevant.filter(x => x.status !== 'Handed Over').findIndex(x => x.id === p.id) + 1
    })),
    trip,
    location,
    stats: { students: 248, buses: 8, drivers: 8, activeTrips: trip.active ? 1 : 0 }
  })
})

app.post('/api/pickups', async (req, res) => {
  if (!['parent', 'admin'].includes(req.profile.role)) {
    return res.status(403).json({ error: 'Only a parent or school admin can request pickup.' })
  }
  const { studentId } = req.body || {}
  if (!studentId) return res.status(400).json({ error: 'Select a student first.' })
  if (supabase) {
    const { data: student } = await req.sb.from('students').select('id,school_id').eq('id', studentId).single()
    if (!student) return res.status(404).json({ error: 'Student not found.' })
    const { data: existing } = await req.sb.from('pickup_requests').select('id').eq('student_id', studentId).neq('status', 'Handed Over').maybeSingle()
    if (existing) return res.status(409).json({ error: 'There is already an active pickup request for this student.' })
    const { data, error } = await req.sb.rpc('request_student_pickup', { target_student: studentId })
    if (error) return res.status(400).json({ error: error.message })
    return res.json(data)
  }
  const found = students.find(s => s.id === studentId)
  if (!found) return res.status(404).json({ error: 'Student not found.' })
  if (pickups.some(p => p.studentId === studentId && p.status !== 'Handed Over')) {
    return res.status(409).json({ error: 'This student already has an active pickup request.' })
  }
  queue++
  const p = {
    id: `pickup-${Date.now()}`,
    studentId,
    studentName: found.name,
    grade: found.grade,
    parentName: found.parentName,
    queueNumber: queue,
    status: 'Waiting',
    arrivalTime: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    position: pickups.filter(x => x.status !== 'Handed Over').length + 1
  }
  pickups.push(p)
  res.status(201).json(p)
})

app.post('/api/pickups/:id/status', async (req, res) => {
  if (!['admin', 'driver'].includes(req.profile.role)) {
    return res.status(403).json({ error: 'Only school staff can update pickup status.' })
  }
  const allowed = ['Called to Gate', 'Ready for Pickup']
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'Invalid pickup status.' })
  const from = req.body.status === 'Called to Gate' ? 'Waiting' : 'Called to Gate'
  if (supabase) {
    const { data, error } = await req.sb.from('pickup_requests').update({ status: req.body.status }).eq('id', req.params.id).eq('status', from).select().single()
    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(409).json({ error: 'Pickup is not at the required previous step.' })
    return res.json(data)
  }
  const p = pickups.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Pickup request not found.' })
  if (p.status !== from) return res.status(409).json({ error: 'Pickup is not at the required previous step.' })
  p.status = req.body.status
  res.json(p)
})

app.post('/api/pickups/:id/handover', async (req, res) => {
  if (!['admin', 'driver'].includes(req.profile.role)) {
    return res.status(403).json({ error: 'Only school staff can confirm handover.' })
  }
  if (supabase) {
    const { data, error } = await req.sb.rpc('confirm_pickup_handover', { target_request: req.params.id })
    if (error) return res.status(400).json({ error: error.message })
    return res.json(data)
  }
  const p = pickups.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Pickup request not found.' })
  if (p.status !== 'Ready for Pickup') return res.status(409).json({ error: 'Call the student and mark them at the gate before handover.' })
  p.status = 'Handed Over'
  res.json(p)
})

app.post('/api/trip/start', async (req, res) => {
  if (req.profile.role !== 'driver') return res.status(403).json({ error: 'Only the assigned driver can start a trip.' })
  if (!['demo', 'real'].includes(req.body?.mode)) return res.status(400).json({ error: 'Choose DEMO or REAL GPS mode.' })
  if (req.body.mode === 'real' && (!Number.isFinite(req.body.lat) || !Number.isFinite(req.body.lng))) {
    return res.status(400).json({ error: 'A GPS location is required to start a live trip.' })
  }
  if (supabase) {
    const { data, error } = await req.sb.from('trips').insert({
      bus_id: (await req.sb.from('drivers').select('bus_id').eq('id', req.profile.id).single()).data?.bus_id,
      route_id: (await req.sb.from('drivers').select('route_id').eq('id', req.profile.id).single()).data?.route_id,
      school_id: req.profile.school_id,
      driver_id: req.profile.id,
      status: 'active',
      started_at: new Date().toISOString()
    }).select().single()
    if (error) return res.status(400).json({ error: error.message })
    trip = { active: true, mode: req.body.mode, id: data.id }
  } else {
    trip = { active: true, mode: req.body.mode, startedAt: new Date().toISOString() }
  }
  if (req.body.mode === 'real') location = { lat: req.body.lat, lng: req.body.lng, updatedAt: new Date().toISOString() }
  res.json(trip)
})

app.post('/api/trip/stop', async (req, res) => {
  if (req.profile.role !== 'driver') return res.status(403).json({ error: 'Only the assigned driver can end a trip.' })
  if (supabase && trip.id) {
    await req.sb.from('trips').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', trip.id)
  }
  trip = { active: false, mode: trip.mode }
  res.json(trip)
})

app.post('/api/location', async (req, res) => {
  if (req.profile.role !== 'driver') return res.status(403).json({ error: 'Only the assigned driver can share trip location.' })
  const { lat, lng } = req.body || {}
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Provide valid GPS coordinates.' })
  }
  if (!trip.active || trip.mode !== 'real') return res.status(409).json({ error: 'No live GPS trip is active.' })
  location = { lat, lng, updatedAt: new Date().toISOString() }
  if (supabase) {
    const { error } = await req.sb.from('bus_locations').insert({
      trip_id: trip.id,
      school_id: req.profile.school_id,
      latitude: lat,
      longitude: lng,
      recorded_at: location.updatedAt
    })
    if (error) return res.status(400).json({ error: error.message })
  }
  res.json(location)
})

app.post('/api/demo/reset', (req, res) => {
  if (req.profile.role !== 'admin') return res.status(403).json({ error: 'Only a school admin can reset demo data.' })
  pickups = []
  queue = 0
  trip = { active: true, mode: 'demo', startedAt: new Date().toISOString() }
  res.json({ ok: true })
})

// Unmatched API routes handler (always return JSON)
app.all('/api/{*splat}', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` })
})

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

// Serve static frontend files from dist/
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.join(__dirname, '../dist')
app.use(express.static(distPath))

app.get('/{*splat}', (_req, res) => {
  const indexHtml = path.join(distPath, 'index.html')
  if (fs.existsSync(indexHtml)) {
    return res.sendFile(indexHtml)
  }
  res.status(200).send(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem;"><h2>PingME API Server running</h2><p>Frontend build not found. Visit <a href="http://localhost:5173">http://localhost:5173</a> for dev server or run <code>npm run build</code>.</p></body></html>`)
})

const port = Number(process.env.PORT || 4000)
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`PingME API ready on http://localhost:${port} and http://127.0.0.1:${port} (${supabase ? 'Supabase' : 'demo'} mode)`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Please terminate any running processes on port ${port} or set PORT in .env.`)
  } else {
    console.error('Server error:', err)
  }
})

export { app, server }

