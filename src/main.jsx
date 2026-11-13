import React, { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Home from './Home'
import Login from './Login'
import Dashboard from './Dashboard'
const Society = lazy(() => import('./Society'))
import { AuthProvider, useAuth } from './auth'
import './style.css'
import 'leaflet/dist/leaflet.css'
function Guard({children}){const {user}=useAuth();return user?children:<Navigate to="/login" replace/>}
function App(){const {user}=useAuth();return <Routes><Route path="/" element={<Home/>}/><Route path="/login" element={user?<Navigate to="/app" replace/>:<Login/>}/><Route path="/app" element={<Guard><Dashboard/></Guard>}/><Route path="/society/*" element={<Suspense fallback={<div style={{padding:'3rem',color:'#8b9ca8',background:'#090d12',minHeight:'100vh'}}>Opening your society workspace…</div>}><Society/></Suspense>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter></React.StrictMode>)
