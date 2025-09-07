const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { validateUser } = require('../middleware/validation');

// 注册
router.post('/register', validateUser, async (req, res) => {
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
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // 创建用户
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert([{
        username,
        email,
        password_hash: passwordHash,
        role,
        full_name,
        phone,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id, username, email, role, full_name, phone, created_at')
      .single();
    
    if (insertError) {
      console.error('创建用户错误:', insertError);
      return res.status(500).json({ message: '注册失败' });
    }
    
    res.status(201).json({
      message: '用户注册成功',
      user: user
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ message: '注册失败' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    // 查找用户
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('is_active', true);
    
    if (userError) {
      console.error('查找用户错误:', userError);
      return res.status(500).json({ message: '登录失败' });
    }
    
    if (!users || users.length === 0) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    
    const user = users[0];
    
    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    
    // 生成JWT令牌
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
        phone: user.phone
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
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '访问被拒绝，缺少令牌' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userResult = await pool.query(
      'SELECT id, username, email, role, full_name, phone, created_at FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: '用户不存在' });
    }
    
    res.json({ user: userResult.rows[0] });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: '无效的令牌' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期' });
    }
    
    console.error('获取用户信息错误:', error);
    res.status(500).json({ message: '获取用户信息失败' });
  }
});

// 修改密码
router.post('/change-password', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    const { currentPassword, newPassword } = req.body;
    
    if (!token) {
      return res.status(401).json({ message: '访问被拒绝，缺少令牌' });
    }
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: '当前密码和新密码不能为空' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: '新密码至少6个字符' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 获取用户当前密码
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    // 验证当前密码
    const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: '当前密码错误' });
    }
    
    // 加密新密码
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    
    // 更新密码
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, decoded.id]
    );
    
    res.json({ message: '密码修改成功' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: '无效的令牌' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期' });
    }
    
    console.error('修改密码错误:', error);
    res.status(500).json({ message: '修改密码失败' });
  }
});

// 获取所有用户（管理员功能）
router.get('/users', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '访问被拒绝，缺少令牌' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 检查权限
    if (!['admin', 'manager'].includes(decoded.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    
    const usersResult = await pool.query(`
      SELECT id, username, email, role, full_name, phone, is_active, created_at
      FROM users
      ORDER BY created_at DESC
    `);
    
    res.json({ users: usersResult.rows });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: '无效的令牌' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期' });
    }
    
    console.error('获取用户列表错误:', error);
    res.status(500).json({ message: '获取用户列表失败' });
  }
});

// 更新用户状态
router.patch('/users/:id/status', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    const { id } = req.params;
    const { is_active } = req.body;
    
    if (!token) {
      return res.status(401).json({ message: '访问被拒绝，缺少令牌' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 检查权限
    if (!['admin', 'manager'].includes(decoded.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    
    // 不能禁用自己的账户
    if (parseInt(id) === decoded.id) {
      return res.status(400).json({ message: '不能禁用自己的账户' });
    }
    
    await pool.query(
      'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [is_active, id]
    );
    
    res.json({ message: '用户状态更新成功' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: '无效的令牌' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期' });
    }
    
    console.error('更新用户状态错误:', error);
    res.status(500).json({ message: '更新用户状态失败' });
  }
});

module.exports = router;
