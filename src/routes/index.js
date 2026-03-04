'use strict';

const { Router } = require('express');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────────
// Route modules will be added here as gateway.js is progressively split.
// Uncomment each line once the corresponding route module is created.
// ─────────────────────────────────────────────────────────────────────────────────

// router.use('/api/auth',     require('./auth'));
// router.use('/api/admin',    require('./admin'));
// router.use('/api/uploads',  require('./uploads'));
// router.use('/api/galleries',require('./galleries'));
// router.use('/api/share',    require('./share'));
// router.use('/api/payments', require('./payments'));
// router.use('/api/users',    require('./users'));

module.exports = router;
