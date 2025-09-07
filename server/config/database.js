const { Pool } = require('pg');

// 检查是否使用 Supabase
const isSupabase = process.env.SUPABASE_URL;

let poolConfig;

if (isSupabase) {
  // 使用 Supabase 连接字符串
  const connectionString = `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
  
  poolConfig = {
    connectionString,
    ssl: { 
      rejectUnauthorized: false,
      ca: undefined
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000, // 进一步增加超时时间
    keepAlive: true,
    keepAliveInitialDelayMillis: 0,
  };
} else {
  // 本地 PostgreSQL 配置
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'loan_management',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: false,
  };
}

const pool = new Pool(poolConfig);

// 测试数据库连接
pool.on('connect', () => {
  console.log('✅ 数据库连接成功');
  if (isSupabase) {
    console.log('🌐 使用 Supabase 数据库');
  }
});

pool.on('error', (err) => {
  console.error('❌ 数据库连接错误:', err);
});

module.exports = pool;
