'use strict';

const path = require('path');

// Resolve app root — works on any OS, no hardcoded Windows paths
const APP_DIR = process.env.APP_DIR
  ? path.resolve(process.env.APP_DIR)
  : path.resolve(__dirname);

module.exports = {
  apps: [
    // ─── AI Health Monitor — Puppeteer-based page checks every 7 minutes ───
    {
      name:               'ai-health-monitor',
      script:             'services/ai-health-monitor.js',
      cwd:                APP_DIR,
      instances:          1,
      exec_mode:          'fork',
      autorestart:        true,
      watch:              false,
      max_memory_restart: '500M', // Puppeteer uses more memory
      log_date_format:    'YYYY-MM-DD HH:mm:ss Z',
      out_file:           path.join(APP_DIR, 'logs', 'ai-health-monitor-out.log'),
      error_file:         path.join(APP_DIR, 'logs', 'ai-health-monitor-err.log'),
      env: {
        NODE_ENV: 'production',
        BASE_URL: 'http://localhost:3000',
      },
    },

    // ─── Basic Health Monitor — Auto-healing every 7 minutes ───────────────
    {
      name:               'health-monitor',
      script:             'services/health-monitor-7min.js',
      cwd:                APP_DIR,
      instances:          1,
      exec_mode:          'fork',
      autorestart:        true,
      watch:              false,
      max_memory_restart: '100M',
      log_date_format:    'YYYY-MM-DD HH:mm:ss Z',
      out_file:           path.join(APP_DIR, 'logs', 'health-monitor-out.log'),
      error_file:         path.join(APP_DIR, 'logs', 'health-monitor-err.log'),
      env: {
        NODE_ENV: 'production',
        HOST:     'localhost',
        PORT:     3000,
      },
    },

    // ─── Main Gateway (fork mode — ports 80/443/3000 need single process) ──
    {
      name:   'doz-gateway',
      script: 'gateway.js',
      cwd:    APP_DIR,

      instances: 1,
      exec_mode: 'fork',

      // Graceful shutdown
      kill_timeout:    30000, // 30s to drain connections before force kill
      listen_timeout:  10000, // 10s to start accepting connections
      wait_ready:      false, // disabled — use health checks instead

      // Zero-downtime restart
      restart_delay: 5000, // 5s between instance restarts (rolling restart)

      // Auto-restart
      autorestart:        true,
      watch:              false,
      max_memory_restart: '900M', // restart before hitting 1 GB limit

      // Crash recovery
      exp_backoff_restart_delay: 100, // exponential backoff starting at 100ms
      max_restarts:              10,  // max restarts within min_uptime window

      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file:        path.join(APP_DIR, 'logs', 'doz-gateway-out.log'),
      error_file:      path.join(APP_DIR, 'logs', 'doz-gateway-err.log'),

      env: {
        NODE_ENV: 'production',
        PORT:     3000,
      },

      // Development environment (local SSL for hosts-file domains)
      env_development: {
        NODE_ENV:      'development',
        PORT:          3000,
        USE_LOCAL_SSL: 'true',
      },

      // Local environment (same as development)
      env_local: {
        NODE_ENV:      'development',
        PORT:          3000,
        USE_LOCAL_SSL: 'true',
      },
    },

    // ─── Mirror Sync — keeps DOZ UP and Spaceship mirror in sync ───────────
    {
      name:               'mirror-sync',
      script:             'services/mirror-sync.js',
      cwd:                APP_DIR,
      instances:          1,
      exec_mode:          'fork',
      autorestart:        true,
      watch:              false,
      max_memory_restart: '200M',
      log_date_format:    'YYYY-MM-DD HH:mm:ss Z',
      out_file:           path.join(APP_DIR, 'logs', 'mirror-sync-out.log'),
      error_file:         path.join(APP_DIR, 'logs', 'mirror-sync-err.log'),
      env: {
        NODE_ENV:         'production',
        MIRROR_URL:       'https://up.doz.com.im',
        LOCAL_GATEWAY:    'http://localhost:3000',
        MIRROR_SYNC_PORT: 3007,
      },
    },

    // ─── Dev Sync — one-way sync from Development to DOZ UP Server ─────────
    {
      name:               'dev-sync',
      script:             'services/dev-sync.js',
      cwd:                APP_DIR,
      instances:          1,
      exec_mode:          'fork',
      autorestart:        true,
      watch:              false,
      max_memory_restart: '200M',
      log_date_format:    'YYYY-MM-DD HH:mm:ss Z',
      out_file:           path.join(APP_DIR, 'logs', 'dev-sync-out.log'),
      error_file:         path.join(APP_DIR, 'logs', 'dev-sync-err.log'),
      env: {
        NODE_ENV:      'production',
        DEV_SYNC_PORT: 3008,
      },
    },

    // ─── Neural Growth Engine — Central AI Brain for Autonomous Development ─
    {
      name:               'neural-growth',
      script:             'services/neural-growth-engine.js',
      cwd:                APP_DIR,
      instances:          1,
      exec_mode:          'fork',
      autorestart:        true,
      watch:              false,
      max_memory_restart: '300M',
      log_date_format:    'YYYY-MM-DD HH:mm:ss Z',
      out_file:           path.join(APP_DIR, 'logs', 'neural-growth-out.log'),
      error_file:         path.join(APP_DIR, 'logs', 'neural-growth-err.log'),
      env: {
        NODE_ENV:           'production',
        NEURAL_GROWTH_PORT: 3009,
      },
    },

    // ─── AI Deployer — Intelligent Deployment Orchestration ────────────────
    {
      name:               'ai-deployer',
      script:             'services/ai-deployer.js',
      cwd:                APP_DIR,
      instances:          1,
      exec_mode:          'fork',
      autorestart:        true,
      watch:              false,
      max_memory_restart: '200M',
      log_date_format:    'YYYY-MM-DD HH:mm:ss Z',
      out_file:           path.join(APP_DIR, 'logs', 'ai-deployer-out.log'),
      error_file:         path.join(APP_DIR, 'logs', 'ai-deployer-err.log'),
      env: {
        NODE_ENV:          'production',
        AI_DEPLOYER_PORT:  3010,
      },
    },
  ],
};
