const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '访问被拒绝，缺少令牌' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 验证用户是否仍然存在且活跃
    const userResult = await pool.query(
      'SELECT id, username, email, role, full_name, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      return res.status(401).json({ message: '令牌无效，用户不存在或已被禁用' });
    }
    
    req.user = userResult.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: '无效的令牌' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '令牌已过期' });
    }
    
    console.error('认证中间件错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
};

// 角色权限检查中间件
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: '未认证' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    
    next();
  };
};

// 管理员权限
const requireAdmin = requireRole(['admin']);

// 经理或管理员权限
const requireManager = requireRole(['manager', 'admin']);

// 秘书或以上权限
const requireSecretary = requireRole(['secretary', 'manager', 'admin']);

module.exports = {
  auth,
  requireRole,
  requireAdmin,
  requireManager,
  requireSecretary
};
