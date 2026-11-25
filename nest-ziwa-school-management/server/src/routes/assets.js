import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();
const imageSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(['image/png','image/jpeg','image/webp']),
  dataBase64: z.string().min(1)
});
const MAX_BYTES = 3 * 1024 * 1024;

router.put('/theme', async (req, res) => {
  if (!['SYSTEM_ADMIN','HEADTEACHER'].includes(req.user.role)) return res.status(403).json({ message: 'Only school administrators can change website colours.' });
  const parsed = z.object({ green: z.string().regex(/^#[0-9a-fA-F]{6}$/), sky: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose valid green and sky blue colours.' });
  const data = Buffer.from(JSON.stringify({ green: parsed.data.green, sky: parsed.data.sky }));
  await prisma.schoolAsset.upsert({ where: { key: 'theme' }, create: { key: 'theme', fileName: 'school-theme.json', mimeType: 'application/json', data, createdById: req.user.id }, update: { fileName: 'school-theme.json', mimeType: 'application/json', data, createdById: req.user.id } });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPDATE', entity: 'School Theme' } });
  res.json({ theme: parsed.data });
});

router.put('/logo', async (req, res) => {
  if (!['SYSTEM_ADMIN','HEADTEACHER'].includes(req.user.role)) return res.status(403).json({ message: 'Only school administrators can change the school logo.' });
  const parsed = imageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Upload a PNG, JPG, or WebP logo.' });
  const data = Buffer.from(parsed.data.dataBase64, 'base64');
  if (!data.length || data.length > MAX_BYTES) return res.status(400).json({ message: 'The logo must be smaller than 3 MB.' });
  const asset = await prisma.schoolAsset.upsert({
    where: { key: 'logo' },
    create: { key: 'logo', fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, data, createdById: req.user.id },
    update: { fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, data, createdById: req.user.id }
  });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPLOAD_SCHOOL_LOGO', entity: 'SchoolAsset', entityId: asset.id, details: { fileName: asset.fileName } } });
  res.json({ logoUrl: `/api/public/logo?v=${asset.updatedAt.getTime()}` });
});

router.put('/signature', async (req, res) => {
  if (['STUDENT','PARENT'].includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  const parsed = imageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Upload a PNG, JPG, or WebP signature.' });
  const data = Buffer.from(parsed.data.dataBase64, 'base64');
  if (!data.length || data.length > MAX_BYTES) return res.status(400).json({ message: 'The processed signature must be smaller than 3 MB.' });
  const asset = await prisma.schoolAsset.upsert({
    where: { key: `signature-${req.user.id}` },
    create: { key: `signature-${req.user.id}`, fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, data, createdById: req.user.id },
    update: { fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, data, createdById: req.user.id }
  });
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPLOAD_SIGNATURE', entity: 'SchoolAsset', entityId: asset.id, details: { fileName: asset.fileName } } });
  res.json({ signatureUrl: `/api/assets/signature?v=${asset.updatedAt.getTime()}` });
});

router.get('/signature', async (req, res) => {
  const asset = await prisma.schoolAsset.findUnique({ where: { key: `signature-${req.user.id}` } });
  if (!asset) return res.status(404).json({ message: 'No saved signature was found.' });
  res.type(asset.mimeType).set('Cache-Control', 'private, no-store').send(Buffer.from(asset.data));
});

router.put('/stamp', async (req,res) => {
  if (!['SYSTEM_ADMIN','HEADTEACHER'].includes(req.user.role)) return res.status(403).json({ message: 'Only school administrators can update the official stamp.' });
  const parsed=imageSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Upload a cleaned PNG, JPG, or WebP stamp.'});
  const data=Buffer.from(parsed.data.dataBase64,'base64');if(!data.length||data.length>MAX_BYTES)return res.status(400).json({message:'The processed stamp must be smaller than 3 MB.'});
  const asset=await prisma.schoolAsset.upsert({where:{key:'stamp'},create:{key:'stamp',fileName:parsed.data.fileName,mimeType:parsed.data.mimeType,data,createdById:req.user.id},update:{fileName:parsed.data.fileName,mimeType:parsed.data.mimeType,data,createdById:req.user.id}});await prisma.auditLog.create({data:{userId:req.user.id,action:'UPLOAD_SCHOOL_STAMP',entity:'SchoolAsset',entityId:asset.id,details:{fileName:asset.fileName}}});res.json({stampUrl:`/api/assets/stamp?v=${asset.updatedAt.getTime()}`});
});
router.get('/stamp', async(req,res)=>{if(['STUDENT','PARENT'].includes(req.user.role))return res.status(403).json({message:'Access denied.'});const asset=await prisma.schoolAsset.findUnique({where:{key:'stamp'}});if(!asset)return res.status(404).json({message:'No school stamp has been saved.'});res.type(asset.mimeType).set('Cache-Control','private, no-store').send(Buffer.from(asset.data));});

router.get('/whatsapp-settings', async(req,res)=>{
  if(['STUDENT','PARENT'].includes(req.user.role))return res.status(403).json({message:'Access denied.'});
  const asset=await prisma.schoolAsset.findUnique({where:{key:'whatsapp-settings'}});
  res.json(asset?JSON.parse(Buffer.from(asset.data).toString('utf8')):{schoolNumber:'',classInviteLinks:{}});
});
router.put('/whatsapp-settings', async(req,res)=>{
  if(!['SYSTEM_ADMIN','HEADTEACHER'].includes(req.user.role))return res.status(403).json({message:'Only school administrators can update WhatsApp contact settings.'});
  const parsed=z.object({
    schoolNumber:z.string().trim().max(32).regex(/^$|^\+?[0-9 ().-]{8,25}$/),
    classInviteLinks:z.record(z.string().url()).default({})
  }).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Enter a valid WhatsApp number and optional WhatsApp class-group invitation links.'});
  for(const link of Object.values(parsed.data.classInviteLinks)){try{if(new URL(link).hostname.toLowerCase()!=='chat.whatsapp.com')return res.status(400).json({message:'Class group links must use https://chat.whatsapp.com/.'});}catch{return res.status(400).json({message:'Enter valid class group links.'});}}
  const schoolNumber=parsed.data.schoolNumber.replace(/[ ().-]/g,'');
  const settings={schoolNumber,classInviteLinks:parsed.data.classInviteLinks};
  const asset=await prisma.schoolAsset.upsert({where:{key:'whatsapp-settings'},create:{key:'whatsapp-settings',fileName:'whatsapp-settings.json',mimeType:'application/json',data:Buffer.from(JSON.stringify(settings)),createdById:req.user.id},update:{fileName:'whatsapp-settings.json',mimeType:'application/json',data:Buffer.from(JSON.stringify(settings)),createdById:req.user.id}});
  await prisma.auditLog.create({data:{userId:req.user.id,action:'UPDATE_WHATSAPP_SETTINGS',entity:'SchoolAsset',entityId:asset.id}});
  res.json(settings);
});

export default router;
