import { Router } from 'express';
import { prisma } from '../db.js';
const router=Router();
router.get('/audit',async(req,res)=>{if(req.user.role!=='DIRECTOR')return res.status(403).json({message:'Director-only activity log.'});const page=Math.max(1,Number(req.query.page)||1),take=100;const [logs,total]=await Promise.all([prisma.auditLog.findMany({include:{user:{select:{name:true,email:true,role:true}}},orderBy:{createdAt:'desc'},skip:(page-1)*take,take}),prisma.auditLog.count()]);res.json({logs,total,page,pages:Math.ceil(total/take)});});
export default router;
