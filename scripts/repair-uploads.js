/**
 * Upload Repair Script
 * Fixes broken image links by:
 * 1. Re-adding orphan files to database
 * 2. Extending expiration for all uploads to 1 year
 *
 * Run with: node scripts/repair-uploads.js
 */

const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');
const dbPath = path.join(__dirname, '..', 'data', 'uploads.json');

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function repairUploads() {
    console.log('=== Upload Repair Script ===\n');

    // 1. Load database
    let db;
    try {
        db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        console.error('Error loading database:', e.message);
        return;
    }

    const trackedFiles = new Set(db.uploads.map(u => u.filename));
    console.log(`Database has ${db.uploads.length} tracked uploads\n`);

    // 2. Scan disk for all files
    let diskFiles;
    try {
        diskFiles = fs.readdirSync(uploadsDir).filter(f =>
            f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') ||
            f.endsWith('.gif') || f.endsWith('.webp') || f.endsWith('.bmp')
        );
    } catch (e) {
        console.error('Error reading uploads directory:', e.message);
        return;
    }

    console.log(`Found ${diskFiles.length} image files on disk\n`);

    // 3. Find orphan files (on disk but not in DB)
    const orphans = diskFiles.filter(f => !trackedFiles.has(f));

    if (orphans.length > 0) {
        console.log(`Found ${orphans.length} orphan files not in database:`);
        orphans.forEach(f => console.log(`  - ${f}`));
        console.log('');
    }

    // 4. Re-add orphans to database
    let addedCount = 0;
    for (const filename of orphans) {
        const filePath = path.join(uploadsDir, filename);
        try {
            const stats = fs.statSync(filePath);
            const id = path.basename(filename, path.extname(filename));

            db.uploads.push({
                id: id,
                filename: filename,
                url: `https://up.doz.com.im/i/${filename}`,
                deviceId: 'recovered',
                timestamp: stats.mtimeMs,
                expiresAt: Date.now() + ONE_YEAR_MS,
                size: stats.size,
                recovered: true,
                recoveredAt: Date.now()
            });
            addedCount++;
        } catch (e) {
            console.error(`  Error adding ${filename}:`, e.message);
        }
    }

    // 5. Extend expiration for ALL existing uploads
    let extendedCount = 0;
    const newExpiry = Date.now() + ONE_YEAR_MS;

    for (const upload of db.uploads) {
        if (!upload.expiresAt || upload.expiresAt < newExpiry) {
            upload.expiresAt = newExpiry;
            extendedCount++;
        }
    }

    // 6. Save database
    try {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        console.log('Database saved successfully!\n');
    } catch (e) {
        console.error('Error saving database:', e.message);
        return;
    }

    // 7. Summary
    console.log('=== Summary ===');
    console.log(`  Orphan files recovered: ${addedCount}`);
    console.log(`  Expiration extended for: ${extendedCount} uploads`);
    console.log(`  Total uploads now: ${db.uploads.length}`);
    console.log(`  New expiration: 1 year from now`);
    console.log('\nDone! All image links should now work.');
}

repairUploads();
