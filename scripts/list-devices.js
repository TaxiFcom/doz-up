const fs = require('fs');
const uploadsDb = JSON.parse(fs.readFileSync('./data/uploads.json', 'utf8'));
const deviceIds = {};
(uploadsDb.uploads || []).forEach(u => {
    if (u.deviceId) {
        if (!deviceIds[u.deviceId]) deviceIds[u.deviceId] = { count: 0, first: '', last: '' };
        deviceIds[u.deviceId].count++;
        const ts = String(u.timestamp || u.createdAt || '');
        if (!deviceIds[u.deviceId].first || ts < deviceIds[u.deviceId].first) deviceIds[u.deviceId].first = ts;
        if (ts > deviceIds[u.deviceId].last) deviceIds[u.deviceId].last = ts;
    }
});
Object.keys(deviceIds).sort().forEach(id => {
    const d = deviceIds[id];
    const first = d.first ? d.first.substring(0, 10) : '?';
    const last = d.last ? d.last.substring(0, 10) : '?';
    console.log(id.padEnd(45) + ' | ' + String(d.count).padStart(3) + ' uploads | ' + first + ' - ' + last);
});
