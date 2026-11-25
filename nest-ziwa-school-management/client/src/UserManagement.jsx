import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';

const STAFF_ROLES=[['HEADTEACHER','Headteacher'],['EXAM_OFFICER','Chief Examinations Officer'],['DIRECTOR','Director'],['BURSAR','Bursar / Accountant'],['TEACHER','Teacher'],['ADMISSIONS','Admissions Officer'],['STOREKEEPER','Storekeeper'],['TRANSPORT_MANAGER','Transport Manager'],['DRIVER','Driver']];

export default function UserManagement({request}){
 const [users,setUsers]=useState([]),[name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('TEACHER');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null);
 async function loadUsers(){const result=await request('/users');setUsers(result.users||[]);}
 useEffect(()=>{loadUsers().catch(e=>setError(e.message));},[]);
 async function submit(event){event.preventDefault();setBusy(true);setError('');setCreated(null);try{const result=await request('/users',{method:'POST',body:JSON.stringify({name,email,role})});setCreated(result);setName('');setEmail('');await loadUsers();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="user-management">
  <div className="section-title"><div><h2>Staff logins</h2><p>Create a role-specific account. The new user must change the temporary password at first sign-in.</p></div></div>
  <form className="user-create-form" onSubmit={submit}><label>Staff name<input required value={name} onChange={event=>setName(event.target.value.toUpperCase())} placeholder="FULL NAME"/></label><label>Email address<input required type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@school.ac.ke"/></label><label>Role<select value={role} onChange={event=>setRole(event.target.value)}>{STAFF_ROLES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="primary-btn" disabled={busy}><UserPlus size={16}/>{busy?'Creating...':'Create staff login'}</button></form>
  {error&&<div className="alert">{error}</div>}{created&&<div className="success-banner"><span>Account created for <b>{created.user.email}</b>. Temporary password: <code>{created.temporaryPassword}</code>. Share it directly with the staff member.</span></div>}
  <div className="user-list">{users.map(user=><div className="user-list-row" key={user.id}><div><b>{user.name}</b><small>{user.email}</small></div><span>{user.role.replaceAll('_',' ')}</span><small>{user.mustChangePassword?'Must change temporary password':'Password active'}</small></div>)}</div>
 </section>;
}
