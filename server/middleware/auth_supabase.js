const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 认证中间件
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }
    
    // 验证JWT令牌
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 从 Supabase 获取用户信息
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, role, full_name, phone, is_active')
      .eq('id', decoded.userId)
      .eq('is_active', true)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ message: '用户不存在或已被禁用' });
    }
    
    // 将用户信息添加到请求对象
    req.user = {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
      phone: user.phone
    };
    
    next();
    
  } catch (error) {
    console.error('认证中间件错误:', error);
    res.status(401).json({ message: '无效的认证令牌' });
  }
};

module.exports = { auth };
