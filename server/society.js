import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import rateLimit from 'express-rate-limit'

const router = Router()
const DEMO_SOCIETY = 'a1000000-0000-4000-8000-000000000001'
const demoAccounts = {
  resident: { id: 'a2000000-0000-4000-8000-000000000001', name: 'Aarav Mehta', email: 'resident@pingme.demo', apartment_id: 'a3000000-0000-4000-8000-000000000101', apartment: 'B-1204', role: 'resident' },
  resident_a803: { id: 'a2000000-0000-4000-8000-000000000004', name: 'Diya Shah', email: 'diya@pingme.demo', apartment_id: 'a3000000-0000-4000-8000-000000000102', apartment: 'A-803', role: 'resident' },
  resident_c502: { id: 'a2000000-0000-4000-8000-000000000005', name: 'Kabir Singh', email: 'kabir@pingme.demo', apartment_id: 'a3000000-0000-4000-8000-000000000103', apartment: 'C-502', role: 'resident' },
  guard: { id: 'a2000000-0000-4000-8000-000000000002', name: 'Ravi Kumar', email: 'guard@pingme.demo', role: 'guard', gate_id: 'a4000000-0000-4000-8000-000000000001' },
  society_admin: { id: 'a2000000-0000-4000-8000-000000000003', name: 'Nisha Rao', email: 'admin@pingme.demo', role: 'society_admin' }
}
const categories = ['Guest', 'Food delivery', 'Courier delivery', 'Maintenance technician', 'Domestic helper', 'Other service provider']
const apartments = [
  { id: demoAccounts.resident.apartment_id, number: 'B-1204', block: 'B', resident: 'Aarav Mehta' },
  { id: 'a3000000-0000-4000-8000-000000000102', number: 'A-803', block: 'A', resident: 'Diya Shah' },
  { id: 'a3000000-0000-4000-8000-000000000103', number: 'C-502', block: 'C', resident: 'Kabir Singh' }
]
const visitors = []
const passes = []
const entries = []
const approvals = []
const scanLogs = []
const auditLogs = []
const flagged = []
const notifications = []
const gates = [{ id: demoAccounts.guard.gate_id, name: 'Main Gate' }, { id: 'a4000000-0000-4000-8000-000000000002', name: 'East Gate' }]
const now = () => new Date().toISOString()
const hash = token => createHash('sha256').update(token).digest('hex')
const uuid = () => randomUUID()
const clean = value => String(value ?? '').trim().slice(0, 120)
function audit(actor,action,entityType,entityId,details={}){auditLogs.unshift({id:uuid(),actor_id:actor?.id,actor_name:actor?.name||actor?.full_name,action,entity_type:entityType,entity_id:entityId,details,created_at:now()})}
const statusFor = (pass) => pass.revoked_at ? 'Revoked Pass' : (new Date(pass.expires_at) <= new Date() ? 'Expired Pass' : (pass.uses >= pass.max_uses ? 'Already Used' : (pass.approval_status === 'pending' ? 'Approval Required' : 'Valid Pass')))

function seedSocietyDemo(){
  const at=(minutes)=>new Date(Date.now()+minutes*60_000).toISOString()
  const seeds=[
    {id:'a5000000-0000-4000-8000-000000000001',resident:demoAccounts.resident,visitor:'Mira Kapoor',category:'Guest',visit:at(-30),active:true},
    {id:'a5000000-0000-4000-8000-000000000002',resident:demoAccounts.resident_a803,visitor:'Bluebell Foods',category:'Food delivery',visit:at(-12),active:true},
    {id:'a5000000-0000-4000-8000-000000000003',resident:demoAccounts.resident_c502,visitor:'Arjun Nair',category:'Courier delivery',visit:at(-100),active:false},
    {id:'a5000000-0000-4000-8000-000000000004',resident:demoAccounts.resident,visitor:'Maya Iyer',category:'Guest',visit:at(55),active:false}
  ]
  for(const sample of seeds){
    const apartment=apartments.find(x=>x.id===sample.resident.apartment_id)
    visitors.push({id:sample.id,society_id:DEMO_SOCIETY,apartment_id:sample.resident.apartment_id,apartment:apartment.number,resident_id:sample.resident.id,resident_name:sample.resident.name,name:sample.visitor,category:sample.category,visit_at:sample.visit,created_at:sample.visit,approval_status:'approved'})
    const futureVisit=new Date(sample.visit)>new Date()
    const pass={id:uuid(),visitor_id:sample.id,token_hash:hash(randomBytes(32).toString('base64url')),expires_at:sample.active||futureVisit?at(120):sample.visit, max_uses:1,uses:sample.active?1:futureVisit?0:1,revoked_at:null,approval_status:'approved'}
    passes.push(pass)
    if(sample.active||new Date(sample.visit)<new Date())entries.push({id:uuid(),visitor_id:sample.id,pass_id:pass.id,society_id:DEMO_SOCIETY,gate_id:gates[0].id,guard_id:demoAccounts.guard.id,checked_in_at:sample.visit,exited_at:sample.active?null:at(-45)})
  }
}
seedSocietyDemo()

const service = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
const demoEnabled = process.env.SOCIETY_DEMO_MODE !== 'false' && !service

async function authenticate(req, res, next) {
  try {
    if (demoEnabled) {
      const role = req.headers['x-society-demo-role']
      const account = demoAccounts[req.headers['x-society-demo-account'] || role]
      if (!account || account.role!==role) return res.status(401).json({ error: 'Choose a synthetic Resident, Security Guard, or Society Admin demo account.' })
      req.actor = { ...account, role, society_id: DEMO_SOCIETY }
      req.db = null
      return next()
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token || !service) return res.status(401).json({ error: 'Sign in with an authorized society account.' })
    const { data: { user }, error } = await service.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Your session has expired. Sign in again.' })
    const { data: profile, error: profileError } = await service.from('society_profiles').select('*').eq('id', user.id).single()
    if (profileError || !profile) return res.status(403).json({ error: 'Your society account has not been provisioned.' })
    req.actor = { ...profile, name: profile.full_name, email: user.email }
    if (profile.role === 'resident') {
      const { data: household } = await service.from('resident_apartments').select('apartment_id').eq('resident_id', user.id).limit(1).maybeSingle()
      req.actor.apartment_id = household?.apartment_id
    }
    if (profile.role === 'guard') {
      const { data: guard } = await service.from('security_guards').select('gate_id').eq('id', user.id).single()
      req.actor.gate_id = guard?.gate_id
    }
    req.db = service
    next()
  } catch (error) { next(error) }
}
router.get('/health', (_req,res)=>res.json({ok:true,mode:service?'supabase':demoEnabled?'synthetic-demo':'unconfigured'}))
router.use(authenticate)
const scanLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many gate scans. Wait a moment and try again.' } })
const requireRole = (...roles) => (req, res, next) => roles.includes(req.actor.role) ? next() : res.status(403).json({ error: 'This action is not available for your account role.' })
const dbError = (error, res) => res.status(400).json({ error: error?.message || 'The visitor request could not be completed.' })

function demoVisitors() {
  return visitors.map(v => {
    const pass = passes.find(p => p.visitor_id === v.id)
    const entry = entries.find(e => e.visitor_id === v.id && !e.exited_at)
    return { ...v, pass_status: pass ? statusFor(pass) : 'Approval Required', pass_id: pass?.id, expires_at: pass?.expires_at, entry_id: entry?.id, checked_in_at: entry?.checked_in_at, checked_out_at: entries.find(e => e.visitor_id === v.id)?.exited_at, inside: Boolean(entry), approval_status: v.approval_status || 'approved' }
  })
}
function allowedVisitors(req, rows) {
  if (req.actor.role === 'resident') return rows.filter(v => v.apartment_id === req.actor.apartment_id || v.resident_id === req.actor.id)
  return rows
}
function makeOverview(req) {
  const list = allowedVisitors(req, demoVisitors()).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
  const day = new Date().toDateString()
  const all = demoVisitors()
  return {
    demo: true, society: 'Maple Grove Residences', actor: req.actor, apartments: req.actor.role==='resident'?apartments.filter(a=>a.id===req.actor.apartment_id):apartments, gates: req.actor.role==='guard'?gates.filter(g=>g.id===req.actor.gate_id):gates, categories, scanLogs:req.actor.role==='resident'?[]:scanLogs.slice(0,20),auditLogs:req.actor.role==='society_admin'?auditLogs.slice(0,30):[],
    visitors: list,
    approvals: approvals.filter(a => req.actor.role !== 'resident' ? true : a.resident_id === req.actor.id).map(({token,...safe})=>safe),
    notifications: notifications.filter(n => req.actor.role !== 'resident' || n.resident_id === req.actor.id).slice(-12).reverse(),
    flagged: req.actor.role === 'society_admin' ? flagged : [],
    stats: { residents: 186, apartments: 204, guards: 12, inside: all.filter(v=>v.inside).length, today: all.filter(v=>new Date(v.created_at).toDateString()===day).length, pending: approvals.filter(a=>a.status==='pending').length },
    trends: [{ day: 'Mon', total: 31 }, { day: 'Tue', total: 42 }, { day: 'Wed', total: 36 }, { day: 'Thu', total: 54 }, { day: 'Fri', total: 48 }, { day: 'Sat', total: 67 }, { day: 'Sun', total: 39 }]
  }
}

router.get('/overview', async (req, res) => {
  if (!req.db) return res.json(makeOverview(req))
  const db = req.db, societyId = req.actor.society_id
  try {
    const [v, a, ap, gp, inside, residents, guards, gatesDb, cats] = await Promise.all([
      db.from('society_visitors').select('*,society_apartments(block,number),society_profiles!society_visitors_resident_id_fkey(full_name),visitor_passes(id,expires_at,revoked_at,uses,max_uses,approval_status),visitor_entries(id,checked_in_at,checked_out_at)', {count:'exact'}).eq('society_id', societyId).order('created_at',{ascending:false}).limit(200),
      db.from('visitor_approvals').select('*,society_visitors(name,category,apartment_id,society_apartments(block,number))').eq('society_id', societyId).eq('status','pending'),
      db.from('society_apartments').select('id,number,block,resident_name').eq('society_id', societyId).order('block').order('number'),
      db.from('society_gates').select('id,name').eq('society_id', societyId).eq('active',true),
      db.from('visitor_entries').select('id',{count:'exact',head:true}).eq('society_id', societyId).is('checked_out_at',null),
      db.from('society_profiles').select('id',{count:'exact',head:true}).eq('society_id', societyId).eq('role','resident'),
      db.from('security_guards').select('id',{count:'exact',head:true}).eq('society_id', societyId),
      db.from('society_gates').select('id,name').eq('society_id', societyId).eq('active',true),
      db.from('visitor_categories').select('name').eq('society_id', societyId).eq('active',true)
    ])
    if (v.error) throw v.error
    let visitorRows = v.data || []
    if (req.actor.role === 'resident') visitorRows = visitorRows.filter(x=>x.resident_id===req.actor.id)
    const ownApartmentRows=req.actor.role==='resident'?(await db.from('resident_apartments').select('apartment_id,society_apartments(id,number,block,resident_name)').eq('society_id',societyId).eq('resident_id',req.actor.id)).data||[]:ap.data||[]
    const safeApartments=ownApartmentRows.map(x=>x.society_apartments||x)
    const todayStart=new Date();todayStart.setHours(0,0,0,0)
    const [society,todayCount,notifs,logs,flags,auditRows]=await Promise.all([db.from('societies').select('name').eq('id',societyId).single(),db.from('visitor_entries').select('id',{count:'exact',head:true}).eq('society_id',societyId).gte('checked_in_at',todayStart.toISOString()),db.from('society_notifications').select('*').eq('profile_id',req.actor.id).order('created_at',{ascending:false}).limit(12),req.actor.role==='resident'?Promise.resolve({data:[]}):db.from('visitor_scan_logs').select('*').eq('society_id',societyId).order('attempted_at',{ascending:false}).limit(20),req.actor.role==='society_admin'?db.from('flagged_visitors').select('*,society_visitors(name,category)').eq('society_id',societyId).is('resolved_at',null).order('created_at',{ascending:false}):Promise.resolve({data:[]}),req.actor.role==='society_admin'?db.from('society_audit_logs').select('*').eq('society_id',societyId).order('created_at',{ascending:false}).limit(30):Promise.resolve({data:[]})])
    const weekStart=new Date();weekStart.setDate(weekStart.getDate()-6);weekStart.setHours(0,0,0,0)
    const {data:weeklyEntries}=await db.from('visitor_entries').select('checked_in_at,checked_out_at').eq('society_id',societyId).gte('checked_in_at',weekStart.toISOString()).limit(2000)
    const trends=Array.from({length:7},(_,i)=>{const date=new Date(weekStart);date.setDate(date.getDate()+i);const key=date.toDateString();return{day:date.toLocaleDateString('en-US',{weekday:'short'}),total:(weeklyEntries||[]).filter(x=>new Date(x.checked_in_at).toDateString()===key).length}})
    const durations=(weeklyEntries||[]).filter(x=>x.checked_out_at).map(x=>(new Date(x.checked_out_at)-new Date(x.checked_in_at))/60000).filter(x=>x>=0)
    const categoriesData=(visitorRows||[]).reduce((acc,x)=>{acc[x.category]=(acc[x.category]||0)+1;return acc},{})
    return res.json({demo:false,society:society.data?.name||'Society',actor:{...req.actor,apartment:safeApartments[0]?`${safeApartments[0].block}-${safeApartments[0].number}`:undefined},visitors:visitorRows.map(x=>({...x,apartment:x.society_apartments?`${x.society_apartments.block}-${x.society_apartments.number}`:'—',resident_name:x.society_profiles?.full_name,pass_id:x.visitor_passes?.[0]?.id,expires_at:x.visitor_passes?.[0]?.expires_at,pass_status:x.visitor_passes?.[0]?statusFor(x.visitor_passes[0]):'Approval Required',entry_id:x.visitor_entries?.find(y=>!y.checked_out_at)?.id,checked_in_at:x.visitor_entries?.[0]?.checked_in_at,checked_out_at:x.visitor_entries?.[0]?.checked_out_at,inside:Boolean(x.visitor_entries?.some(y=>!y.checked_out_at))})),approvals:(a.data||[]).map(x=>({...x,visitor_name:x.society_visitors?.name,category:x.society_visitors?.category,apartment:x.society_visitors?.society_apartments?`${x.society_visitors.society_apartments.block}-${x.society_visitors.society_apartments.number}`:'—'})),apartments:safeApartments,gates:gp.data||[],categories:(cats.data||[]).map(x=>x.name),notifications:notifs.data||[],scanLogs:logs.data||[],auditLogs:auditRows.data||[],flagged:(flags.data||[]).map(x=>({...x,visitor_name:x.society_visitors?.name})),stats:{residents:residents.count||0,apartments:ap.data?.length||0,guards:guards.count||0,inside:inside.count||0,today:todayCount.count||0,pending:a.data?.length||0},trends,analytics:{averageVisitMinutes:durations.length?Math.round(durations.reduce((sum,x)=>sum+x,0)/durations.length):null,categories:categoriesData}})
  } catch(e) { dbError(e,res) }
})

router.post('/passes', requireRole('resident'), async (req,res) => {
  const visitorName=clean(req.body?.visitorName), category=clean(req.body?.category), visitAt=req.body?.visitAt, expiresAt=req.body?.expiresAt
  const apartmentId=req.body?.apartmentId || req.actor.apartment_id
  const maxUses=Number(req.body?.maxUses || 1)
  if (visitorName.length<2 || !categories.includes(category) && !(req.db && category.length>1) || !visitAt || !expiresAt || !Number.isInteger(maxUses) || maxUses<1 || maxUses>20) return res.status(400).json({error:'Enter a visitor name, category, visit time, expiry, and use limit (1–20).'})
  if (+new Date(expiresAt)<=Date.now() || +new Date(visitAt)<Date.now()-60_000 || +new Date(expiresAt)<=+new Date(visitAt)) return res.status(400).json({error:'The expiry must be after the visit time and in the future.'})
  if (req.db) {
    try {
      const token=randomBytes(32).toString('base64url')
      const {data,error}=await req.db.rpc('create_society_visitor_pass',{p_actor:req.actor.id,p_apartment:apartmentId,p_name:visitorName,p_phone:clean(req.body?.phone)||null,p_category:category,p_visit_at:visitAt,p_expires_at:expiresAt,p_max_uses:maxUses,p_token_hash:hash(token)})
      if(error)throw error
      return res.status(201).json({...data,token,qrValue:`PINGME:${token}`})
    } catch(e) { return dbError(e,res) }
  }
  const apartment=apartments.find(a=>a.id===apartmentId)
  if(!apartment||apartmentId!==req.actor.apartment_id)return res.status(403).json({error:'You can only issue passes for your authorized apartment.'})
  const token=randomBytes(32).toString('base64url'), visitor={id:uuid(),society_id:DEMO_SOCIETY,apartment_id:apartmentId,resident_id:req.actor.id,resident_name:req.actor.name,apartment:apartment.number,name:visitorName,category,visit_at:visitAt,created_at:now(),approval_status:'approved'}
  const pass={id:uuid(),visitor_id:visitor.id,token_hash:hash(token),expires_at:expiresAt,max_uses:maxUses,uses:0,revoked_at:null,approval_status:'approved'}
  visitors.push(visitor);passes.push(pass);notifications.push({id:uuid(),resident_id:req.actor.id,title:'Visitor pass ready',body:`Pass created for ${visitorName}.`,created_at:now()});audit(req.actor,'visitor.pass_created','visitor_pass',pass.id,{category})
  res.status(201).json({visitor,pass:{id:pass.id,expires_at:pass.expires_at,max_uses:pass.max_uses},token,qrValue:`PINGME:${token}`})
})

router.post('/passes/:id/revoke', requireRole('resident'), async(req,res)=>{
  if(req.db){const {data:existing,error:checkError}=await req.db.from('visitor_passes').select('id,society_visitors!inner(resident_id,society_id)').eq('id',req.params.id).eq('society_visitors.resident_id',req.actor.id).eq('society_id',req.actor.society_id).maybeSingle();if(checkError||!existing)return res.status(404).json({error:'Visitor pass not found.'});const {data,error}=await req.db.from('visitor_passes').update({revoked_at:now()}).eq('id',req.params.id).eq('society_id',req.actor.society_id).select('id').single();if(error)return dbError(error,res);await req.db.from('society_audit_logs').insert({society_id:req.actor.society_id,actor_id:req.actor.id,action:'visitor.pass_revoked',entity_type:'visitor_pass',entity_id:data.id});return res.json({ok:true,id:data.id})}
  const p=passes.find(x=>x.id===req.params.id),v=visitors.find(x=>x.id===p?.visitor_id)
  if(!p||v?.resident_id!==req.actor.id)return res.status(404).json({error:'Visitor pass not found.'})
  p.revoked_at=now();notifications.push({id:uuid(),resident_id:req.actor.id,title:'Pass revoked',body:`${v.name} can no longer use this pass.`,created_at:now()});audit(req.actor,'visitor.pass_revoked','visitor_pass',p.id);res.json({ok:true})
})

router.post('/scan', scanLimiter, requireRole('guard','society_admin'), async(req,res)=>{
  let raw=clean(req.body?.code);raw=raw.replace(/^PINGME:/i,'').trim()
  const gateId=req.body?.gateId || req.actor.gate_id
  if(req.actor.role==='guard'&&gateId!==req.actor.gate_id)return res.status(403).json({status:'Invalid QR Code',allowed:false,error:'This guard is not assigned to the selected gate.'})
  const tokenHash=/^[A-Za-z0-9_-]{30,100}$/.test(raw)?hash(raw):''
  if(req.db){
    const {data,error}=await req.db.rpc('verify_and_check_in_visitor',{p_token_hash:tokenHash,p_actor:req.actor.id,p_gate:gateId})
    if(error)return dbError(error,res)
    return res.json(data)
  }
  const p=passes.find(x=>x.token_hash===tokenHash),v=visitors.find(x=>x.id===p?.visitor_id)
  let result={status:'Invalid QR Code',allowed:false}
  if(p&&v){
    const state=statusFor(p)
    if(state==='Valid Pass'){
      if(entries.some(e=>e.visitor_id===v.id&&!e.exited_at)) result={status:'Already Used',allowed:false}
      else {const entry={id:uuid(),visitor_id:v.id,pass_id:p.id,society_id:DEMO_SOCIETY,gate_id:gateId,guard_id:req.actor.id,checked_in_at:now(),exited_at:null};entries.unshift(entry);p.uses++;result={status:'Valid Pass',allowed:true,visitor:{id:v.id,name:v.name,category:v.category,apartment:v.apartment,resident_name:v.resident_name,visit_at:v.visit_at},entry};notifications.push({id:uuid(),resident_id:v.resident_id,title:'Visitor checked in',body:`${v.name} has entered at ${gates.find(g=>g.id===gateId)?.name||'the gate'}.`,created_at:now()})}
    } else result={status:state,allowed:false,visitor:{name:v.name,apartment:v.apartment}}
  }
  scanLogs.unshift({id:uuid(),society_id:DEMO_SOCIETY,gate_id:gateId,guard_id:req.actor.id,visitor_id:v?.id||null,result:result.status,created_at:now()});audit(req.actor,'visitor.qr_scan_'+result.status.toLowerCase().replaceAll(' ','_'),'visitor_scan',v?.id||null,{result:result.status,gateId})
  res.json(result)
})

router.post('/checkout/:entryId', requireRole('guard','society_admin'), async(req,res)=>{
  if(req.db){const {data,error}=await req.db.rpc('record_visitor_checkout',{p_entry:req.params.entryId,p_actor:req.actor.id});if(error)return dbError(error,res);return res.json(data)}
  const e=entries.find(x=>x.id===req.params.entryId&&!x.exited_at);if(!e)return res.status(404).json({error:'Active visit not found.'})
  e.exited_at=now();notifications.push({id:uuid(),resident_id:visitors.find(v=>v.id===e.visitor_id)?.resident_id,title:'Visitor checked out',body:`${visitors.find(v=>v.id===e.visitor_id)?.name} has left the society.`,created_at:now()});audit(req.actor,'visitor.checked_out','visitor_entry',e.id);res.json(e)
})

router.post('/approvals/request', requireRole('guard','society_admin'), async(req,res)=>{
  const name=clean(req.body?.visitorName),apartmentId=clean(req.body?.apartmentId),category=clean(req.body?.category)
  if(name.length<2||!apartmentId||!categories.includes(category))return res.status(400).json({error:'Visitor name, apartment, and category are required.'})
  if(req.db){const {data:ap}=await req.db.from('resident_apartments').select('resident_id,society_apartments!inner(number,block)').eq('apartment_id',apartmentId).eq('society_id',req.actor.society_id).limit(1).maybeSingle();if(!ap)return res.status(404).json({error:'Apartment not found or no resident is linked.'});const {data:v,error}=await req.db.from('society_visitors').insert({society_id:req.actor.society_id,apartment_id:apartmentId,resident_id:ap.resident_id,name,category,approval_status:'pending',visit_at:now()}).select().single();if(error)return dbError(error,res);const {data:a,error:ae}=await req.db.from('visitor_approvals').insert({society_id:req.actor.society_id,visitor_id:v.id,resident_id:ap.resident_id,status:'pending'}).select().single();if(ae)return dbError(ae,res);await Promise.all([req.db.from('society_notifications').insert({society_id:req.actor.society_id,profile_id:ap.resident_id,visitor_id:v.id,title:'Visitor approval needed',body:`${name} is waiting at the gate.`}),req.db.from('society_audit_logs').insert({society_id:req.actor.society_id,actor_id:req.actor.id,action:'visitor.approval_requested',entity_type:'visitor_approval',entity_id:a.id,details:{apartment_id:apartmentId}})]);return res.status(201).json({...a,visitor_name:v.name,apartment:`${ap.society_apartments.block}-${ap.society_apartments.number}`,category:v.category})}
  const ap=apartments.find(x=>x.id===apartmentId);if(!ap)return res.status(404).json({error:'Apartment not found.'})
  const household=Object.values(demoAccounts).find(x=>x.role==='resident'&&x.apartment_id===apartmentId)||demoAccounts.resident;const v={id:uuid(),society_id:DEMO_SOCIETY,apartment_id:apartmentId,apartment:ap.number,resident_id:household.id,resident_name:household.name,name,category,visit_at:now(),created_at:now(),approval_status:'pending'};visitors.push(v)
  const a={id:uuid(),visitor_id:v.id,resident_id:v.resident_id,visitor_name:name,apartment:ap.number,category,status:'pending',created_at:now()};approvals.push(a);notifications.push({id:uuid(),resident_id:v.resident_id,title:'Visitor approval needed',body:`${name} is waiting at the gate.`,created_at:now()});audit(req.actor,'visitor.approval_requested','visitor_approval',a.id,{apartment:ap.number});res.status(201).json(a)
})

router.post('/approvals/:id/:decision', requireRole('resident'), async(req,res)=>{
  const decision=req.params.decision
  if(!['approve','reject'].includes(decision))return res.status(400).json({error:'Choose approve or reject.'})
  if(req.db){const token=decision==='approve'?randomBytes(32).toString('base64url'):null,expiresAt=decision==='approve'?new Date(Date.now()+45*60_000).toISOString():null;const {data,error}=await req.db.rpc('decide_visitor_approval',{p_approval:req.params.id,p_approve:decision==='approve',p_actor:req.actor.id,p_token_hash:token?hash(token):null,p_expires_at:expiresAt});if(error)return dbError(error,res);return res.json({...data,token,expires_at:expiresAt})}
  const a=approvals.find(x=>x.id===req.params.id&&x.resident_id===req.actor.id);if(!a)return res.status(404).json({error:'Approval request not found.'});if(a.status!=='pending')return res.status(409).json({error:'This request has already been decided.'})
  a.status=decision==='approve'?'approved':'rejected';a.decided_at=now();const v=visitors.find(x=>x.id===a.visitor_id);v.approval_status=a.status
  if(decision==='approve'){
    const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+45*60_000).toISOString(),p={id:uuid(),visitor_id:v.id,token_hash:hash(token),expires_at:expiresAt,max_uses:1,uses:0,revoked_at:null,approval_status:'approved'};passes.push(p);a.token=token;a.expires_at=expiresAt
  }
  notifications.push({id:uuid(),resident_id:req.actor.id,title:`Visitor ${a.status}`,body:`${v.name} — gate approval ${a.status}.`,created_at:now()});audit(req.actor,`visitor.approval_${a.status}`,'visitor_approval',a.id);res.json({id:a.id,status:a.status,visitor_name:v.name,token:a.token,expires_at:a.expires_at})
})

router.post('/flag/:visitorId', requireRole('society_admin'), async(req,res)=>{
  const reason=clean(req.body?.reason);if(reason.length<5)return res.status(400).json({error:'Add a short factual note explaining the flag.'})
  if(req.db){const {data:visitor,error:lookupError}=await req.db.from('society_visitors').select('id').eq('id',req.params.visitorId).eq('society_id',req.actor.society_id).maybeSingle();if(lookupError||!visitor)return res.status(404).json({error:'Visitor record not found in this society.'});const {data,error}=await req.db.from('flagged_visitors').insert({society_id:req.actor.society_id,visitor_id:req.params.visitorId,reason,created_by:req.actor.id}).select().single();if(error)return dbError(error,res);await req.db.from('society_audit_logs').insert({society_id:req.actor.society_id,actor_id:req.actor.id,action:'visitor.flagged_for_review',entity_type:'flagged_visitor',entity_id:data.id});return res.status(201).json(data)}
  const visitor=visitors.find(x=>x.id===req.params.visitorId);if(!visitor)return res.status(404).json({error:'Visitor record not found.'});const item={id:uuid(),visitor_id:visitor.id,visitor_name:visitor.name,reason,created_by:req.actor.id,created_at:now()};flagged.push(item);audit(req.actor,'visitor.flagged_for_review','flagged_visitor',item.id);res.status(201).json(item)
})

router.get('/history', requireRole('society_admin','guard'), async(req,res)=>{
  if(req.db){const [entryRows,logs,auditRows]=await Promise.all([req.db.from('visitor_entries').select('*,society_visitors(name,category,apartment_id),society_gates(name)').eq('society_id',req.actor.society_id).order('checked_in_at',{ascending:false}).limit(300),req.db.from('visitor_scan_logs').select('*').eq('society_id',req.actor.society_id).order('attempted_at',{ascending:false}).limit(300),req.actor.role==='society_admin'?req.db.from('society_audit_logs').select('*,society_profiles(full_name)').eq('society_id',req.actor.society_id).order('created_at',{ascending:false}).limit(100):Promise.resolve({data:[]})]);if(entryRows.error)return dbError(entryRows.error,res);if(logs.error)return dbError(logs.error,res);if(auditRows.error)return dbError(auditRows.error,res);return res.json({entries:entryRows.data,scanLogs:logs.data,auditLogs:auditRows.data||[]})}
  res.json({entries:entries.map(e=>({...e,visitor:visitors.find(v=>v.id===e.visitor_id)})),scanLogs:scanLogs.slice(0,300),auditLogs:req.actor.role==='society_admin'?auditLogs.slice(0,100):[]})
})
router.get('/management', requireRole('society_admin'), async(req,res)=>{
  if(!req.db)return res.json({apartments,gates,categories,accounts:Object.values(demoAccounts).map(a=>({id:a.id,name:a.name,email:a.email,role:a.role,apartment:a.apartment||null,gate:a.gate_id||null}))})
  const [aps,gateRows,categoryRows,profiles]=await Promise.all([
    req.db.from('society_apartments').select('*').eq('society_id',req.actor.society_id).order('block').order('number'),
    req.db.from('society_gates').select('*').eq('society_id',req.actor.society_id),
    req.db.from('visitor_categories').select('*').eq('society_id',req.actor.society_id),
    req.db.from('society_profiles').select('id,full_name,role,security_guards(gate_id),resident_apartments(apartment_id)').eq('society_id',req.actor.society_id)
  ])
  const issue=[aps,gateRows,categoryRows,profiles].find(x=>x.error);if(issue)return dbError(issue.error,res)
  res.json({apartments:aps.data,gates:gateRows.data,categories:categoryRows.data.map(x=>x.name),accounts:profiles.data})
})
router.post('/management/apartments',requireRole('society_admin'),async(req,res)=>{
  const block=clean(req.body?.block),number=clean(req.body?.number),residentName=clean(req.body?.residentName)||null
  if(!block||!number)return res.status(400).json({error:'Block and apartment number are required.'})
  if(req.db){const {data,error}=await req.db.from('society_apartments').insert({society_id:req.actor.society_id,block,number,resident_name:residentName}).select().single();if(error)return dbError(error,res);return res.status(201).json(data)}
  if(apartments.some(x=>x.block===block&&x.number===number))return res.status(409).json({error:'That apartment already exists.'})
  const item={id:uuid(),block,number,resident:residentName};apartments.push(item);res.status(201).json(item)
})
router.post('/management/gates',requireRole('society_admin'),async(req,res)=>{
  const name=clean(req.body?.name);if(name.length<2)return res.status(400).json({error:'Enter a gate name.'})
  if(req.db){const {data,error}=await req.db.from('society_gates').insert({society_id:req.actor.society_id,name}).select().single();if(error)return dbError(error,res);return res.status(201).json(data)}
  const item={id:uuid(),name};gates.push(item);res.status(201).json(item)
})
router.post('/management/categories',requireRole('society_admin'),async(req,res)=>{
  const name=clean(req.body?.name);if(name.length<2||name.length>60)return res.status(400).json({error:'Enter a visitor category (2–60 characters).'});
  if(req.db){const {data,error}=await req.db.from('visitor_categories').insert({society_id:req.actor.society_id,name}).select().single();if(error)return dbError(error,res);return res.status(201).json(data)}
  if(categories.includes(name))return res.status(409).json({error:'That visitor category already exists.'});categories.push(name);res.status(201).json({name})
})
router.post('/management/assign',requireRole('society_admin'),async(req,res)=>{
  const profileId=clean(req.body?.profileId),apartmentId=clean(req.body?.apartmentId)
  if(!req.db)return res.status(409).json({error:'Additional account assignment requires a connected society database.'})
  const [profileResult,apartmentResult]=await Promise.all([req.db.from('society_profiles').select('id,role').eq('id',profileId).eq('society_id',req.actor.society_id).maybeSingle(),req.db.from('society_apartments').select('id').eq('id',apartmentId).eq('society_id',req.actor.society_id).maybeSingle()])
  if(!profileResult.data||profileResult.data.role!=='resident'||!apartmentResult.data)return res.status(400).json({error:'Choose a resident and apartment in this society.'})
  const {error}=await req.db.from('resident_apartments').insert({society_id:req.actor.society_id,resident_id:profileId,apartment_id:apartmentId});if(error)return dbError(error,res)
  await req.db.from('society_audit_logs').insert({society_id:req.actor.society_id,actor_id:req.actor.id,action:'resident.apartment_linked',entity_type:'resident_apartment',details:{profile_id:profileId,apartment_id:apartmentId}})
  res.json({ok:true})
})
router.post('/management/accounts',requireRole('society_admin'),async(req,res)=>{
  const name=clean(req.body?.name),email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||''),role=req.body?.role,apartmentId=req.body?.apartmentId,gateId=req.body?.gateId
  if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<10||!['resident','guard','society_admin'].includes(role))return res.status(400).json({error:'Provide a name, valid email, role, and temporary password with at least 10 characters.'})
  if(!req.db)return res.status(409).json({error:'Synthetic demo roles are preconfigured; connect Supabase to provision additional sign-in accounts.'})
  if(role==='resident'){const {data}=await req.db.from('society_apartments').select('id').eq('id',apartmentId).eq('society_id',req.actor.society_id).maybeSingle();if(!data)return res.status(400).json({error:'Choose an apartment in this society.'})}
  if(role==='guard'){const {data}=await req.db.from('society_gates').select('id').eq('id',gateId).eq('society_id',req.actor.society_id).maybeSingle();if(!data)return res.status(400).json({error:'Choose an authorized gate.'})}
  const {data:created,error:createError}=await req.db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});if(createError)return dbError(createError,res)
  const {error:profileError}=await req.db.from('society_profiles').upsert({id:created.user.id,society_id:req.actor.society_id,role,full_name:name})
  if(profileError){await req.db.auth.admin.deleteUser(created.user.id);return dbError(profileError,res)}
  if(role==='resident'){const {error}=await req.db.from('resident_apartments').insert({society_id:req.actor.society_id,resident_id:created.user.id,apartment_id:apartmentId});if(error){await req.db.from('society_profiles').delete().eq('id',created.user.id);await req.db.auth.admin.deleteUser(created.user.id);return dbError(error,res)}}
  if(role==='guard'){const {error}=await req.db.from('security_guards').insert({id:created.user.id,society_id:req.actor.society_id,gate_id:gateId});if(error){await req.db.from('society_profiles').delete().eq('id',created.user.id);await req.db.auth.admin.deleteUser(created.user.id);return dbError(error,res)}}
  await req.db.from('society_audit_logs').insert({society_id:req.actor.society_id,actor_id:req.actor.id,action:'account.provisioned',entity_type:'society_profile',entity_id:created.user.id,details:{role}})
  res.status(201).json({id:created.user.id,name,email,role})
})

export default router
