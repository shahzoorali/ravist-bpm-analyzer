module.exports = {
  apps: [
    {
      name:         'ravist-bpm',
      script:       'server.js',
      instances:    1,               // single instance — ffmpeg is stateful
      autorestart:  true,
      watch:        false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT:     3100,
      },
      // Restart if it crashes, back off exponentially
      exp_backoff_restart_delay: 2000,
      error_file:  'logs/error.log',
      out_file:    'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
