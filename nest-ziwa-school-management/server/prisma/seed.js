import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const email = 'admin@nestziwa.ac.ke';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
    await prisma.user.create({
      data: { name: 'Nest Ziwa System Administrator', email, passwordHash, role: 'SYSTEM_ADMIN' }
    });
    console.log(`Seed administrator created: ${email}`);
  } else {
    console.log('Seed administrator already exists; no changes made.');
  }
} finally {
  await prisma.$disconnect();
}
