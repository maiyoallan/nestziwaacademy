import { Router } from 'express';
import nodemailer from 'nodemailer';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();
const roles = ['SYSTEM_ADMIN','HEADTEACHER','EXAM_OFFICER','TEACHER'];
const schema = z.object({ id: z.string().optional(), title: z.string().trim().min(3).max(180), html: z.string().min(1).max(4000000) });
function clean(html) { return sanitizeHtml(html, { allowedTags: ['main','article','h1','h2','h3','p','div','span','br','hr','b','strong','i','em','u','ul','ol','li','table','thead','tbody','tr','td','th','img','svg','rect','text','line'], allowedAttributes: { '*':['style','class'], img:['src','alt','width','height'], svg:['viewBox','role','aria-label','width','height'], rect:['x','y','width','height','rx','fill'], text:['x','y','text-anchor','font-size','fill'], line:['x1','x2','y1','y2','stroke'] }, allowedSchemes: ['http','https','mailto','data'], allowedStyles: { '*': { color:[/^#[0-9a-fA-F]{3,8}$/], 'background-color':[/^#[0-9a-fA-F]{3,8}$/], 'text-align':[/^(left|center|right)$/], 'font-size':[/^\d+(px|pt|em|%)$/], 'font-weight':[/^(normal|bold|[1-9]00)$/], width:[/^\d+(px|%)$/], 'max-width':[/^\d+(px|%)$/], padding:[/^\d+(px|%)$/], margin:[/^\d+(px|%)$/], 'border-collapse':[/^collapse$/], border:[/^[\w#().,\s-]+$/] } } }); }
router.use((req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({message:'Access denied.'}));
router.get('/drafts', async (_req,res)=>{
 const rows=await prisma.moduleRecord.findMany({where:{module:'communications'},orderBy:{updatedAt:'desc'},take:100});
 res.json({drafts:rows.filter(row=>row.data?.['Report Card HTML']).map(row=>({id:row.id,title:row.data.Title,html:row.data['Report Card HTML'],updatedAt:row.updatedAt}))});
});
router.post('/drafts', async (req,res)=>{
 const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'A report card title and content are required.'});
 const html=clean(parsed.data.html);const data={Title:parsed.data.title,'Report Card HTML':html,Status:'DRAFT'};
 let row;
 if(parsed.data.id){row=await prisma.moduleRecord.findFirst({where:{id:parsed.data.id,module:'communications'}});if(!row?.data?.['Report Card HTML'])return res.status(404).json({message:'Report card draft not found.'});row=await prisma.$transaction(async(tx)=>{const saved=await tx.moduleRecord.update({where:{id:row.id},data:{title:`REPORT CARD: ${parsed.data.title}`,data}});await tx.auditLog.create({data:{userId:req.user.id,action:'UPDATE',entity:'Report Card',entityId:saved.id}});return saved;});}
 else row=await prisma.$transaction(async(tx)=>{const created=await tx.moduleRecord.create({data:{module:'communications',title:`REPORT CARD: ${parsed.data.title}`,data,createdById:req.user.id}});await tx.auditLog.create({data:{userId:req.user.id,action:'CREATE',entity:'Report Card',entityId:created.id}});return created;});
 res.json({draft:{id:row.id,title:row.data.Title,html:row.data['Report Card HTML'],updatedAt:row.updatedAt}});
});
router.post('/send', async (req,res)=>{
 if(!process.env.SMTP_URL||!process.env.MAIL_FROM)return res.status(503).json({message:'Report card email is not configured. Set SMTP_URL and MAIL_FROM in the API environment.'});
 const parsed=z.object({recipient:z.string().email(),subject:z.string().trim().min(3).max(180),html:z.string().min(1).max(4000000)}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({message:'Enter a valid recipient, subject, and report card.'});
 try{const transporter=nodemailer.createTransport(process.env.SMTP_URL);await transporter.sendMail({from:process.env.MAIL_FROM,to:parsed.data.recipient,subject:parsed.data.subject,html:clean(parsed.data.html)});await prisma.auditLog.create({data:{userId:req.user.id,action:'SEND_REPORT_CARD',entity:'Report Card',details:{recipient:parsed.data.recipient,subject:parsed.data.subject}}});res.json({sent:true});}
 catch(error){console.error('Report card delivery failed:',error.message);res.status(502).json({message:'The mail provider could not send this report card. Check the SMTP settings and try again.'});}
});
export default router;
