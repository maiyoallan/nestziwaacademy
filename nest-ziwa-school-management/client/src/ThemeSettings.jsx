import React, { useEffect, useState } from 'react';

const DEFAULTS = { green: '#15803D', sky: '#0284C7' };
function normalizeTheme(theme) {
  const legacy = { '#16804a': DEFAULTS.green, '#36a9dc': DEFAULTS.sky };
  const green = String(theme?.green || DEFAULTS.green).toLowerCase();
  const sky = String(theme?.sky || DEFAULTS.sky).toLowerCase();
  return { green: legacy[green] || green, sky: legacy[sky] || sky };
}
function applyTheme(theme) {
  document.documentElement.style.setProperty('--theme-green', theme.green);
  document.documentElement.style.setProperty('--theme-sky', theme.sky);
  document.documentElement.dataset.theme = 'school';
}

export default function ThemeSettings({ request }) {
  const [theme, setTheme] = useState(() => {
    try { return normalizeTheme(JSON.parse(localStorage.getItem('nz_theme') || '{}')); }
    catch { return DEFAULTS; }
  });
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(() => { applyTheme(theme); localStorage.setItem('nz_theme', JSON.stringify(theme)); }, [theme]);
  useEffect(() => { let active=true;fetch(`${import.meta.env.VITE_API_URL||'http://localhost:5000/api'}/public/theme`).then(response=>response.ok?response.json():null).then(value=>{if(active&&value?.green&&value?.sky)setTheme(normalizeTheme(value));}).catch(()=>{});return()=>{active=false;}; },[]);
  async function save(){setBusy(true);setMessage('');try{await request('/assets/theme',{method:'PUT',body:JSON.stringify(theme)});setMessage('School colours saved for all users.');}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  return <section className="theme-settings-card"><div><div className="eyebrow">SCHOOL BRANDING</div><h2>Website colours</h2><p>Choose green and sky blue for the school website. Saved colours apply to every staff and student account.</p>{message&&<small className="theme-save-message">{message}</small>}</div><div className="theme-swatches"><label><span>Green</span><input aria-label="Choose theme green" type="color" value={theme.green} onChange={event => setTheme(current => ({ ...current, green: event.target.value }))}/></label><label><span>Sky blue</span><input aria-label="Choose theme sky blue" type="color" value={theme.sky} onChange={event => setTheme(current => ({ ...current, sky: event.target.value }))}/></label><button className="secondary-btn" onClick={() => setTheme(DEFAULTS)}>Reset school colours</button><button className="primary-btn" disabled={busy} onClick={save}>{busy?'Saving...':'Save school colours'}</button></div></section>;
}
