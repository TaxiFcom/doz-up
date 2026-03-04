const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const DATA_DIR = path.join(__dirname, '..', 'data');

async function migrate() {
  console.log('Starting DOZ UP JSON to PostgreSQL migration...');
  
  try {
    // Migrate Users
    const usersFile = path.join(DATA_DIR, 'users.json');
    if (fs.existsSync(usersFile)) {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      console.log('Found ' + users.length + ' users to migrate');
      
      for (const user of users) {
        const passwordHash = user.passwordHash ? 
          await bcrypt.hash(user.passwordHash, 10) : null;
        
        await prisma.user.upsert({
          where: { id: user.id },
          update: {
            email: user.email,
            name: user.name,
            passwordHash: passwordHash,
            status: user.status || 'ACTIVE',
            planId: user.planId,
            storageLimitMb: BigInt(user.storageLimitMb || 512),
            storageUsedMb: BigInt(user.storageUsedMb || 0),
            createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
            updatedAt: new Date()
          },
          create: {
            id: user.id,
            email: user.email,
            name: user.name,
            passwordHash: passwordHash,
            status: user.status || 'ACTIVE',
            planId: user.planId,
            storageLimitMb: BigInt(user.storageLimitMb || 512),
            storageUsedMb: BigInt(user.storageUsedMb || 0),
            createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
            updatedAt: new Date()
          }
        });
      }
      console.log('Users migrated');
    }
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
