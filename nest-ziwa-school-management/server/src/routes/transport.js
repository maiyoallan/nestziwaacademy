import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { ensureSchoolAndChart } from './accounting.js';

const router = Router();
const readRoles = ['SYSTEM_ADMIN','HEADTEACHER','TRANSPORT_MANAGER','DRIVER','BURSAR','DIRECTOR'];
const writeRoles = ['SYSTEM_ADMIN','HEADTEACHER','TRANSPORT_MANAGER'];
function authorize(req, res, write=false) {
  const allowed = write ? writeRoles : readRoles;
  if (!allowed.includes(req.user.role)) { res.status(403).json({ message: write ? 'Transport assignment editing access denied.' : 'Transport records access denied.' }); return false; }
  return true;
}
async function schoolFor(req) {
  if (req.user.role !== 'DIRECTOR') return ensureSchoolAndChart();
  const requested = String(req.query.schoolId || req.body.schoolId || '');
  const links = await prisma.schoolLink.findMany({ where: { directorId: req.user.id }, include: { school: true } });
  if (requested) {
    const match = links.find(link => link.schoolId === requested);
    if (!match) throw Object.assign(new Error('You can only access schools linked to your director account.'), { status: 403 });
    return match.school;
  }
  if (links.length === 1) return links[0].school;
  throw Object.assign(new Error('Choose a linked school first.'), { status: 400 });
}

router.get('/students', async (req, res) => {
  if (!authorize(req)) return;
  const records = await prisma.moduleRecord.findMany({ where: { module: 'students' }, select: { id: true, title: true, data: true }, orderBy: { updatedAt: 'asc' }, take: 2000 });
  res.json({ students: records });
});

router.get('/', async (req, res) => {
  if (!authorize(req)) return;
  try {
    const school = await schoolFor(req);
    const [routes, vehicles, assignments] = await Promise.all([
      prisma.transportRoute.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.vehicle.findMany({ where: { OR: [{ schoolId: school.id }, { schoolId: null }] }, include: { route: true }, orderBy: [{ name: 'asc' }, { registrationNo: 'asc' }] }),
      prisma.transportAssignment.findMany({ where: { schoolId: school.id }, include: { studentRecord: { select: { id: true, title: true, data: true } }, vehicle: { include: { route: true } }, route: true }, orderBy: { assignedAt: 'desc' }, take: 1000 })
    ]);
    res.json({ school, routes, vehicles, assignments });
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'Transport records could not be loaded.' }); }
});

router.post('/routes', async (req, res) => {
  if (!authorize(req, res, true)) return;
  const parsed = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(250).optional(), fee: z.number().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter a route name and optional fee.' });
  try {
    const route = await prisma.$transaction(async (tx) => {
      const saved = await tx.transportRoute.create({ data: { name: parsed.data.name.toUpperCase(), description: parsed.data.description || null, fee: parsed.data.fee === undefined ? null : new Prisma.Decimal(parsed.data.fee) } });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'CREATE_TRANSPORT_ROUTE', entity: 'TransportRoute', entityId: saved.id } });
      return saved;
    });
    res.status(201).json({ route });
  } catch { res.status(409).json({ message: 'That route could not be created.' }); }
});

router.post('/vehicles', async (req, res) => {
  if (!authorize(req, res, true)) return;
  const parsed = z.object({ schoolId: z.string().optional(), name: z.string().trim().min(2).max(80), registrationNo: z.string().trim().min(2).max(30), make: z.string().trim().max(80).optional(), vehicleClass: z.enum(['BUS','MINIBUS','VAN','SHUTTLE_CAR','CAR']), capacity: z.number().int().positive().max(100).optional(), routeId: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter vehicle name, registration, class, and optional capacity/route.' });
  try {
    const school = await schoolFor(req);
    if (parsed.data.routeId && !await prisma.transportRoute.findUnique({ where: { id: parsed.data.routeId } })) return res.status(400).json({ message: 'Choose a valid transport route.' });
    const vehicle = await prisma.$transaction(async (tx) => {
      const saved = await tx.vehicle.create({ data: { schoolId: school.id, name: parsed.data.name.toUpperCase(), registrationNo: parsed.data.registrationNo.toUpperCase(), make: parsed.data.make || null, vehicleClass: parsed.data.vehicleClass, capacity: parsed.data.capacity || null, routeId: parsed.data.routeId || null } });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'CREATE_TRANSPORT_VEHICLE', entity: 'Vehicle', entityId: saved.id, details: { name: saved.name, vehicleClass: saved.vehicleClass } } });
      return saved;
    });
    res.status(201).json({ vehicle });
  } catch (error) { res.status(error.code === 'P2002' ? 409 : error.status || 500).json({ message: error.code === 'P2002' ? 'That vehicle registration is already in use.' : error.message || 'Vehicle could not be created.' }); }
});

router.post('/assignments', async (req, res) => {
  if (!authorize(req, res, true)) return;
  const parsed = z.object({ schoolId: z.string().optional(), studentRecordId: z.string().min(1), vehicleId: z.string().min(1), routeId: z.string().optional(), feeAmount: z.number().nonnegative().optional(), billingCycle: z.enum(['TERM','MONTH','YEAR']).default('TERM') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose a student and named vehicle and enter an optional fare.' });
  try {
    const school = await schoolFor(req);
    const [student, vehicle] = await Promise.all([
      prisma.moduleRecord.findFirst({ where: { id: parsed.data.studentRecordId, module: 'students' } }),
      prisma.vehicle.findFirst({ where: { id: parsed.data.vehicleId, OR: [{ schoolId: school.id }, { schoolId: null }] } })
    ]);
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found for this school.' });
    if (parsed.data.routeId && !await prisma.transportRoute.findUnique({ where: { id: parsed.data.routeId } })) return res.status(400).json({ message: 'Choose a valid route.' });
    const admissionNumber = String(student.data?.['Admission number'] || '').trim().toUpperCase();
    if (!admissionNumber) return res.status(400).json({ message: 'Student is missing an admission number.' });
    const assignment = await prisma.$transaction(async tx => {
      const current = await tx.transportAssignment.findFirst({ where: { studentRecordId: student.id, status: 'ACTIVE' } });
      if (current) throw Object.assign(new Error('This student already has an active vehicle assignment. End it before assigning another vehicle.'), { status: 409 });
      if (vehicle.capacity) {
        const occupants = await tx.transportAssignment.count({ where: { schoolId: school.id, vehicleId: vehicle.id, status: 'ACTIVE' } });
        if (occupants >= vehicle.capacity) throw Object.assign(new Error(`${vehicle.name || vehicle.registrationNo} has reached its ${vehicle.capacity}-student capacity.`), { status: 409 });
      }
      const route = parsed.data.routeId ? await tx.transportRoute.findUnique({ where: { id: parsed.data.routeId } }) : null;
      const fare = parsed.data.feeAmount ?? Number(route?.fee || 0);
      const saved = await tx.transportAssignment.create({ data: {
        schoolId: school.id, studentRecordId: student.id, vehicleId: vehicle.id, routeId: parsed.data.routeId || vehicle.routeId || null,
        assignedById: req.user.id, feeAmount: new Prisma.Decimal(fare), billingCycle: parsed.data.billingCycle,
        activeKey: `student:${student.id}`
      }, include: { studentRecord: { select: { id: true, title: true, data: true } }, vehicle: true, route: true } });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'ASSIGN_STUDENT_TRANSPORT', entity: 'TransportAssignment', entityId: saved.id, details: { admissionNumber, vehicleId: vehicle.id, feeAmount: Number(saved.feeAmount) } } });
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ assignment });
  } catch (error) { res.status(error.code === 'P2002' ? 409 : error.status || 500).json({ message: error.code === 'P2002' ? 'The student already has an active transport assignment.' : error.message || 'Transport assignment could not be saved.' }); }
});

router.post('/assignments/:id/end', async (req, res) => {
  if (!authorize(req, res, true)) return;
  try {
    const assignment = await prisma.transportAssignment.findUnique({ where: { id: req.params.id } });
    if (!assignment) return res.status(404).json({ message: 'Transport assignment not found.' });
    if (assignment.status !== 'ACTIVE') return res.status(409).json({ message: 'This transport assignment has already ended.' });
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.transportAssignment.update({ where: { id: assignment.id }, data: { status: 'ENDED', endedAt: new Date(), activeKey: null } });
      await tx.auditLog.create({ data: { userId: req.user.id, action: 'END_STUDENT_TRANSPORT', entity: 'TransportAssignment', entityId: assignment.id } });
      return saved;
    });
    res.json({ assignment: updated });
  } catch (error) { res.status(error.status || 500).json({ message: error.message || 'Assignment could not be ended.' }); }
});

export default router;
