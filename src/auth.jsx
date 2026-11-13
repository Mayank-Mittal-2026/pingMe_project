import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
const AuthContext = createContext(null)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('pingme-user') || 'null'))
  async function sessionUser(session) {
    if (!session) return null
    const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
    return { email: session.user.email, role: data?.role || 'parent', token: session.access_token }
  }
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(async ({ data }) => { const next = await sessionUser(data.session); if(next){setUser(next);localStorage.setItem('pingme-user',JSON.stringify(next))} })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { setTimeout(()=>sessionUser(session).then(next=>{setUser(next);if(next)localStorage.setItem('pingme-user',JSON.stringify(next));else localStorage.removeItem('pingme-user')}),0) })
    return () => data.subscription.unsubscribe()
  }, [])
  async function signIn(email, password, role) {
    if (supabase) { const {data,error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; const next=await sessionUser(data.session); setUser(next);localStorage.setItem('pingme-user',JSON.stringify(next));return }
    if (!email.includes('@') || password.length < 4) throw new Error('Enter a valid email and a password with at least 4 characters.')
    const next={email,role};setUser(next);localStorage.setItem('pingme-user',JSON.stringify(next))
  }
  async function register(name,email,password,role) { if(supabase){const {error}=await supabase.auth.signUp({email,password,options:{data:{name}} });if(error)throw error;await signIn(email,password,role);return} await signIn(email,password,role) }
  async function signOut(){if(supabase)await supabase.auth.signOut();setUser(null);localStorage.removeItem('pingme-user')}
  return <AuthContext.Provider value={{user,signIn,register,signOut}}>{children}</AuthContext.Provider>
}
export const useAuth=()=>useContext(AuthContext)

