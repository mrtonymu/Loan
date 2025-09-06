const { Pool } = require('pg');

// 检查是否使用 Supabase
const isSupabase = process.env.SUPABASE_URL;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'loan_management',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Supabase 特定配置
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
});

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
