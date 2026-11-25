import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Download, Italic, Mail, Printer, Save, Underline } from 'lucide-react';

const DEFAULT_CONTENT = '<h1>NEST ZIWA SCHOOLS NEWSLETTER</h1><h2>Term highlights</h2><p>Type your school news here. Select any text to format it with the toolbar.</p><p><br></p><p>With regards,<br><strong>School Administration</strong></p>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
}

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not prepare the newsletter logo.'));
    reader.readAsDataURL(blob);
  });
}

export default function NewsletterDesigner({ request, logoSrc }) {
  const editorRef = useRef(null);
  const canvasRef = useRef(null);
  const [subject,setSubject]=useState('Nest Ziwa Schools Newsletter');
  const [recipients,setRecipients]=useState('');
  const [drafts,setDrafts]=useState([]);
  const [draftId,setDraftId]=useState('');
  const [logoPosition,setLogoPosition]=useState({left:26,top:24});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{request('/newsletters/drafts').then(data=>setDrafts(data.drafts||[])).catch(e=>setError(e.message));},[]);

  async function newsletterHtml(){
    const logoResponse=await fetch(logoSrc);
    if(!logoResponse.ok)throw new Error('Could not load the school logo.');
    const logoData=await dataUrlFromBlob(await logoResponse.blob());
    const body=editorRef.current?.innerHTML||DEFAULT_CONTENT;
    return `<main class="newsletter-page"><img class="newsletter-logo" src="${logoData}" alt="Nest Ziwa Schools logo" style="left:${logoPosition.left}px;top:${logoPosition.top}px"><article>${body}</article></main>`;
  }

  async function saveDraft(){
    setBusy(true);setError('');setMessage('');
    try{
      const html=await newsletterHtml();
      const result=await request('/newsletters/drafts',{method:'POST',body:JSON.stringify({id:draftId||undefined,subject,html})});
      setDraftId(result.draft.id);
      setDrafts(current=>[result.draft,...current.filter(draft=>draft.id!==result.draft.id)]);
      setMessage('Newsletter draft saved in the school database.');
      return result.draft;
    }catch(e){setError(e.message);return null;}finally{setBusy(false);}
  }

  async function sendNewsletter(){
    const addresses=recipients.split(/[;,\n]/).map(value=>value.trim()).filter(Boolean);
    if(!addresses.length){setError('Enter at least one recipient email address.');return;}
    const draft=await saveDraft();
    if(!draft)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await request('/newsletters/send',{method:'POST',body:JSON.stringify({recipients:addresses,subject,html:draft.html})});
      setMessage(`Newsletter sent to ${result.recipientCount} recipient${result.recipientCount===1?'':'s'}.`);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  async function downloadWord(){
    try{
      const html=await newsletterHtml();
      const documentHtml=`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title><style>body{font-family:Arial,sans-serif;color:#211b2c;margin:0}.newsletter-page{position:relative;max-width:800px;min-height:1000px;margin:20px auto;padding:145px 48px 50px;box-sizing:border-box}.newsletter-logo{position:absolute;width:120px;height:120px;object-fit:contain}article{line-height:1.65}h1{color:#163b91;font-size:28px}h2{color:#2153ad}</style></head><body>${html}</body></html>`;
      const url=URL.createObjectURL(new Blob([documentHtml],{type:'application/msword'}));
      const link=document.createElement('a');link.href=url;link.download='Nest-Ziwa-Newsletter.doc';link.click();URL.revokeObjectURL(url);
    }catch(e){setError(e.message);}
  }

  function printNewsletter(){
    newsletterHtml().then(html=>{
      const printWindow=window.open('','_blank','width=900,height=1000');
      if(!printWindow){setError('Allow pop-ups to print or save this newsletter as PDF.');return;}
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title><style>@page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#211b2c}.newsletter-page{position:relative;min-height:260mm;padding:130px 24px 30px}.newsletter-logo{position:absolute;width:110px;height:110px;object-fit:contain}article{line-height:1.65}h1{color:#163b91}h2{color:#2153ad}</style></head><body>${html}</body></html>`);
      printWindow.document.close();printWindow.focus();setTimeout(()=>printWindow.print(),300);
    }).catch(e=>setError(e.message));
  }

  function moveLogo(event){
    const rect=canvasRef.current?.getBoundingClientRect();
    if(!rect)return;
    setLogoPosition({left:Math.max(0,Math.min(rect.width-120,event.clientX-rect.left-60)),top:Math.max(0,Math.min(rect.height-120,event.clientY-rect.top-60))});
  }

  function loadDraft(event){
    const draft=drafts.find(item=>item.id===event.target.value);
    if(!draft)return;
    setDraftId(draft.id);setSubject(draft.subject);
    if(editorRef.current)editorRef.current.innerHTML=draft.html;
    setError('');setMessage('Draft loaded. You can edit and save it again.');
  }

  function format(command){editorRef.current?.focus();document.execCommand(command,false,null);}

  return <section className="newsletter-studio">
    <div className="newsletter-controls">
      <label>Newsletter subject<input value={subject} onChange={event=>setSubject(event.target.value)}/></label>
      <label>Load saved draft<select value="" onChange={loadDraft}><option value="">Choose a saved newsletter</option>{drafts.map(draft=><option key={draft.id} value={draft.id}>{draft.subject}</option>)}</select></label>
    </div>
    <label className="recipient-field">Recipients (email addresses, separated by commas)<input value={recipients} onChange={event=>setRecipients(event.target.value)} placeholder="families@example.com, staff@example.com"/></label>
    <div className="newsletter-actions"><div className="format-toolbar"><button type="button" title="Bold" onMouseDown={event=>event.preventDefault()} onClick={()=>format('bold')}><Bold size={16}/></button><button type="button" title="Italic" onMouseDown={event=>event.preventDefault()} onClick={()=>format('italic')}><Italic size={16}/></button><button type="button" title="Underline" onMouseDown={event=>event.preventDefault()} onClick={()=>format('underline')}><Underline size={16}/></button><button type="button" title="Align left" onMouseDown={event=>event.preventDefault()} onClick={()=>format('justifyLeft')}><AlignLeft size={16}/></button><button type="button" title="Center" onMouseDown={event=>event.preventDefault()} onClick={()=>format('justifyCenter')}><AlignCenter size={16}/></button><button type="button" title="Align right" onMouseDown={event=>event.preventDefault()} onClick={()=>format('justifyRight')}><AlignRight size={16}/></button></div><div className="newsletter-actions-right"><button className="secondary-btn" onClick={downloadWord}><Download size={16}/> Download Word</button><button className="secondary-btn" onClick={printNewsletter}><Printer size={16}/> Print / Save PDF</button><button className="secondary-btn" onClick={saveDraft} disabled={busy}><Save size={16}/>{busy?'Saving...':'Save draft'}</button><button className="primary-btn" onClick={sendNewsletter} disabled={busy}><Mail size={16}/>{busy?'Sending...':'Send newsletter'}</button></div></div>
    {error&&<div className="alert">{error}</div>}{message&&<div className="success-banner">{message}</div>}
    <div className="newsletter-workspace"><div className="newsletter-canvas" ref={canvasRef}>
      <img className="draggable-newsletter-logo" src={logoSrc} alt="Drag to move logo" draggable onDragEnd={moveLogo} style={{left:logoPosition.left,top:logoPosition.top}} title="Drag this logo to position it"/>
      <article className="newsletter-editable" contentEditable suppressContentEditableWarning ref={editorRef} onInput={()=>{}} dangerouslySetInnerHTML={{__html:DEFAULT_CONTENT}}/>
    </div><aside className="newsletter-help"><b>Design your newsletter</b><p>Type directly on the page. Select text to format it. Drag the school crest to move it.</p><p>Download Word to continue editing in Microsoft Word, or print and choose “Save as PDF”.</p><p>Sending uses the school SMTP settings. Recipient addresses are hidden from one another.</p></aside></div>
  </section>;
}
