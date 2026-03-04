module.exports = {
  apps: [
  // AI Health Monitor - Puppeteer-based page checks every 7 minutes
  {
    name: 'ai-health-monitor',
    script: 'services/ai-health-monitor.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M', // Puppeteer uses more memory
    env: {
      NODE_ENV: 'production',
      BASE_URL: 'http://localhost:3000'
    }
  },
  // Basic Health Monitor - Auto-healing every 7 minutes
  {
    name: 'health-monitor',
    script: 'services/health-monitor-7min.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '100M',
    env: {
      NODE_ENV: 'production',
      HOST: 'localhost',
      PORT: 3000
    }
  },
  // Main Gateway (fork mode - ports 80/443/3000 need single process)
  {
    name: 'doz-gateway',
    script: 'gateway.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',

    // ============ GRACEFUL SHUTDOWN CONFIG ============
    kill_timeout: 30000,        // 30s to drain connections before force kill
    listen_timeout: 10000,      // 10s to start accepting connections
    wait_ready: false,          // Disabled for now - use health checks instead

    // ============ ZERO-DOWNTIME RESTART ============
    restart_delay: 5000,        // 5s between instance restarts (rolling restart)

    // ============ AUTO-RESTART CONFIG ============
    autorestart: true,
    watch: false,
    max_memory_restart: '900M', // Restart before hitting 1GB limit

    // ============ CRASH RECOVERY ============
    exp_backoff_restart_delay: 100,  // Exponential backoff starting at 100ms
    max_restarts: 10,                // Max restarts within min_uptime window

    // ============ ENVIRONMENT ============
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },

    // Development environment (local SSL for hosts file domains)
    env_development: {
      NODE_ENV: 'development',
      PORT: 3000,
      USE_LOCAL_SSL: 'true'
    },

    // Local environment (same as development)
    env_local: {
      NODE_ENV: 'development',
      PORT: 3000,
      USE_LOCAL_SSL: 'true'
    }
  },
  // Mirror Sync - Keeps DOZ UP and Spaceship mirror in sync
  {
    name: 'mirror-sync',
    script: 'services/mirror-sync.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      MIRROR_URL: 'https://up.doz.com.im',
      LOCAL_GATEWAY: 'http://localhost:3000',
      MIRROR_SYNC_PORT: 3007
    }
  },
  // Dev Sync - One-way sync from Development to DOZ UP Server
  {
    name: 'dev-sync',
    script: 'services/dev-sync.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      DEV_SYNC_PORT: 3008
    }
  },
  // Neural Growth Engine - Central AI Brain for Autonomous Development
  {
    name: 'neural-growth',
    script: 'services/neural-growth-engine.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      NEURAL_GROWTH_PORT: 3009
    }
  },
  // AI Deployer - Intelligent Deployment Orchestration
  {
    name: 'ai-deployer',
    script: 'services/ai-deployer.js',
    cwd: 'C:/DOZ UP',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      AI_DEPLOYER_PORT: 3010
    }
  }]
};
