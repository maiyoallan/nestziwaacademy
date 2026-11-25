import { useEffect, useState } from 'react';
import { Download, ImagePlus, PenTool, Upload } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image file.'));
    reader.readAsDataURL(file);
  });
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image.')); };
    image.src = url;
  });
}

async function extractSignature(file) {
  const image = await imageFromFile(file);
  const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const brightness = (pixels.data[i] * 0.299) + (pixels.data[i + 1] * 0.587) + (pixels.data[i + 2] * 0.114);
    const alpha = Math.max(0, Math.min(255, Math.round((238 - brightness) * 2.2)));
    pixels.data[i] = 28; pixels.data[i + 1] = 35; pixels.data[i + 2] = 62; pixels.data[i + 3] = alpha;
    if (alpha > 24) {
      const pixel = i / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('No dark handwritten marks were found. Use a clear photo or scan of the signature.');
  context.putImageData(pixels, 0, 0);
  const padding = 20;
  const crop = document.createElement('canvas');
  const cropLeft = Math.max(0, left - padding), cropTop = Math.max(0, top - padding);
  const cropRight = Math.min(canvas.width, right + padding + 1), cropBottom = Math.min(canvas.height, bottom + padding + 1);
  crop.width = cropRight - cropLeft; crop.height = cropBottom - cropTop;
  crop.getContext('2d').drawImage(canvas, cropLeft, cropTop, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const dataUrl = crop.toDataURL('image/png');
  return { dataUrl, dataBase64: dataUrl.split(',')[1] };
}

export default function ImageAssetTools({ request, token, logoSrc, onLogoChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [signatureSrc, setSignatureSrc] = useState('');
  const [stampSrc, setStampSrc] = useState('');

  useEffect(() => {
    let objectUrl = '';
    fetch(`${API}/assets/signature`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => {
      if (!response.ok) return null;
      return response.blob();
    }).then((blob) => {
      if (blob) { objectUrl = URL.createObjectURL(blob); setSignatureSrc(objectUrl); }
    }).catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token]);
  useEffect(() => {let objectUrl='';fetch(`${API}/assets/stamp`,{headers:{Authorization:`Bearer ${token}`}}).then(response=>response.ok?response.blob():null).then(blob=>{if(blob){objectUrl=URL.createObjectURL(blob);setStampSrc(objectUrl);}}).catch(()=>{});return()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);};},[token]);

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy('logo'); setError('');
    try {
      const dataUrl = await readDataUrl(file);
      const result = await request('/assets/logo', { method: 'PUT', body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: dataUrl.split(',')[1] }) });
      onLogoChange(`${API.replace(/\/api$/, '')}${result.logoUrl}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); event.target.value = ''; }
  }

  async function uploadSignature(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy('signature'); setError('');
    try {
      const processed = await extractSignature(file);
      await request('/assets/signature', { method: 'PUT', body: JSON.stringify({ fileName: 'signature.png', mimeType: 'image/png', dataBase64: processed.dataBase64 }) });
      setSignatureSrc(processed.dataUrl);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); event.target.value = ''; }
  }

  async function uploadStamp(event) {
    const file=event.target.files?.[0];if(!file)return;setBusy('stamp');setError('');
    try{const processed=await extractSignature(file);await request('/assets/stamp',{method:'PUT',body:JSON.stringify({fileName:'school-stamp.png',mimeType:'image/png',dataBase64:processed.dataBase64})});setStampSrc(processed.dataUrl);}
    catch(e){setError(e.message);}finally{setBusy('');event.target.value='';}
  }

  function downloadImage(src, fileName) {
    const link = document.createElement('a');
    link.href = src; link.download = fileName; link.click();
  }

  return <section className="asset-tools">
    <div className="section-title"><div><h2>School artwork</h2><p>Store the approved logo and a cleaned signature in the school database.</p></div></div>
    {error&&<div className="alert">{error}</div>}
    <div className="asset-tool-grid">
      <article className="asset-tool-card"><div className="asset-preview logo-preview"><img src={logoSrc} alt="Current Nest Ziwa logo"/></div><div><b>School logo</b><p>PNG, JPG, or WebP. A replacement is shared across the website.</p><div className="asset-actions"><label className="secondary-btn"><ImagePlus size={16}/>{busy==='logo'?'Saving...':'Upload logo'}<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo}/></label><button className="secondary-btn" onClick={()=>downloadImage(logoSrc,'Nest-Ziwa-School-Logo.png')}><Download size={16}/> Download logo</button></div></div></article>
      <article className="asset-tool-card"><div className="asset-preview signature-preview">{signatureSrc?<img src={signatureSrc} alt="Cleaned handwritten signature"/>:<PenTool size={32}/>}</div><div><b>Signature background remover</b><p>Upload a photo or scan. The tool removes the light background, crops the handwriting, and saves a transparent PNG to your account.</p><div className="asset-actions"><label className="secondary-btn"><Upload size={16}/>{busy==='signature'?'Cleaning...':'Upload signature'}<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadSignature}/></label>{signatureSrc&&<button className="secondary-btn" onClick={()=>downloadImage(signatureSrc,'cleaned-signature.png')}><Download size={16}/> Download PNG</button>}</div></div></article>
      <article className="asset-tool-card"><div className="asset-preview signature-preview">{stampSrc?<img src={stampSrc} alt="Cleaned school stamp"/>:<PenTool size={32}/>}</div><div><b>Official stamp background remover</b><p>Upload a stamp scan to remove a light background and store a transparent copy for student identity cards.</p><div className="asset-actions"><label className="secondary-btn"><Upload size={16}/>{busy==='stamp'?'Cleaning...':'Upload school stamp'}<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadStamp}/></label>{stampSrc&&<button className="secondary-btn" onClick={()=>downloadImage(stampSrc,'cleaned-school-stamp.png')}><Download size={16}/> Download PNG</button>}</div></div></article>
    </div>
  </section>;
}
