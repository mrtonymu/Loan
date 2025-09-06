const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    // 使用 Supabase 查询用户
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('is_active', true)
      .single();
    
    if (error || !users) {
      console.log('用户查询错误:', error);
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    
    // 验证密码
    const isValidPassword = await bcrypt.compare(password, users.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    
    // 生成JWT令牌
    const token = jwt.sign(
      { 
        userId: users.id, 
        username: users.username, 
        role: users.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // 返回用户信息和令牌
    res.json({
      message: '登录成功',
      token,
      user: {
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        full_name: users.full_name,
        phone: users.phone
      }
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ message: '登录失败' });
  }
});

// 获取当前用户信息
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 从 Supabase 获取最新用户信息
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, role, full_name, phone, is_active')
      .eq('id', decoded.userId)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ message: '用户不存在' });
    }
    
    res.json({ user });
    
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(401).json({ message: '无效的认证令牌' });
  }
});

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role, full_name, phone } = req.body;
    
    // 检查用户名和邮箱是否已存在
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`);
    
    if (checkError) {
      console.error('检查用户存在性错误:', checkError);
      return res.status(500).json({ message: '注册失败' });
    }
    
    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名或邮箱已存在' });
    }
    
    // 加密密码
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    // 创建用户
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([{
        username,
        email,
        password_hash,
        role: role || 'employee',
        full_name,
        phone,
        is_active: true,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (insertError) {
      console.error('创建用户错误:', insertError);
      return res.status(500).json({ message: '注册失败' });
    }
    
    res.status(201).json({
      message: '注册成功',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        full_name: newUser.full_name,
        phone: newUser.phone
      }
    });
    
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ message: '注册失败' });
  }
});

module.exports = router;
