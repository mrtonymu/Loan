const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('测试 Supabase 连接...');
console.log('URL:', supabaseUrl);
console.log('Key 长度:', supabaseKey?.length);

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    // 测试连接
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Supabase 连接失败:', error.message);
    } else {
      console.log('✅ Supabase 连接成功');
      console.log('数据:', data);
    }
  } catch (err) {
    console.error('❌ 连接错误:', err.message);
  }
}

testConnection();
