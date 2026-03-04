const fs = require('fs');

const userId = 'cee80a281d61b279ec9e64fa';

// Only link the current active devices
const myDevices = [
    'win-1769500341464-8qg3hs0q',  // current desktop (most recent win- with 30 uploads)
    'win-1769457302768-kkanwwek',   // previous desktop (35 uploads)
    'DOZ-050D48A6',                  // desktop DOZ device
];

// Fresh links
const links = {
    byUserId: {},
    byDeviceId: {}
};

links.byUserId[userId] = {
    email: 'it@taxif.com',
    deviceIds: myDevices,
    linkedAt: new Date().toISOString()
};

myDevices.forEach(devId => {
    links.byDeviceId[devId] = {
        userId: userId,
        email: 'it@taxif.com',
        linkedAt: new Date().toISOString()
    };
});

fs.writeFileSync('./data/user-device-links.json', JSON.stringify(links, null, 2));
console.log('Reset device links.');
console.log('Linked devices:', myDevices.length);
myDevices.forEach(d => console.log('  -', d));

// Count uploads
const uploadsDb = JSON.parse(fs.readFileSync('./data/uploads.json', 'utf8'));
const mySet = new Set(myDevices);
const count = (uploadsDb.uploads || []).filter(u => mySet.has(u.deviceId)).length;
console.log('Uploads accessible:', count);
