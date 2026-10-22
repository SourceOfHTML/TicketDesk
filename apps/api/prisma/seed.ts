import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/auth/password';
import { createAdapter } from '../src/prisma/create-adapter';

async function main(): Promise<void> {
  const email = process.env.STAFF_EMAIL?.trim().toLowerCase();
  const password = process.env.STAFF_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'STAFF_EMAIL and STAFF_PASSWORD must be set. Run `pnpm bootstrap` from the repository root.',
    );
  }

  const prisma = new PrismaClient({ adapter: createAdapter() });

  try {
    const passwordHash = await hashPassword(password);

    await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, role: 'STAFF' },
      update: { passwordHash, role: 'STAFF' },
    });

    console.log(`Seeded Staff account ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
