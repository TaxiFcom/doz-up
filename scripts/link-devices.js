const fs = require('fs');
const links = JSON.parse(fs.readFileSync('./data/user-device-links.json', 'utf8'));
const uploadsDb = JSON.parse(fs.readFileSync('./data/uploads.json', 'utf8'));
const userId = 'cee80a281d61b279ec9e64fa';

// Get all unique device IDs from uploads
const allDeviceIds = [...new Set(
    (uploadsDb.uploads || [])
        .map(u => u.deviceId)
        .filter(d => d && d !== 'null')
)];

const existing = new Set(links.byUserId[userId].deviceIds || []);
let added = 0;

allDeviceIds.forEach(devId => {
    if (!existing.has(devId)) {
        links.byUserId[userId].deviceIds.push(devId);
        existing.add(devId);
        if (!links.byDeviceId) links.byDeviceId = {};
        links.byDeviceId[devId] = { userId, email: 'it@taxif.com', linkedAt: new Date().toISOString() };
        added++;
    }
});

fs.writeFileSync('./data/user-device-links.json', JSON.stringify(links, null, 2));
console.log('Linked', added, 'new devices');
console.log('Total linked:', links.byUserId[userId].deviceIds.length);

const total = (uploadsDb.uploads || []).filter(u => existing.has(u.deviceId)).length;
console.log('Total uploads now accessible:', total);
