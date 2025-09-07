const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth_supabase');

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const { validateCustomer } = require('../middleware/validation');
const { 
  requirePermission, 
  dataAccessControl, 
  PERMISSIONS 
} = require('../middleware/permissions');

// 生成客户代号和编号
const generateCustomerCodes = async () => {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  
  // 获取当月客户数量
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM customers WHERE EXTRACT(YEAR FROM created_at) = $1 AND EXTRACT(MONTH FROM created_at) = $2',
    [year, month]
  );
  
  const count = parseInt(countResult.rows[0].count) + 1;
  const customerCode = `C${year}${month}${String(count).padStart(3, '0')}`;
  const customerNumber = `CN${year}${month}${String(count).padStart(4, '0')}`;
  
  return { customerCode, customerNumber };
};

// 计算RM金额 (根据业务规则)
const calculateRMAmount = (principalAmount, interestRate, loanTermMonths) => {
  const monthlyRate = interestRate / 100 / 12;
  const totalInterest = principalAmount * monthlyRate * loanTermMonths;
  return principalAmount + totalInterest;
};

// 获取所有客户
router.get('/', 
  auth, 
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  dataAccessControl('customers'),
  async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT c.*, u.full_name as assigned_to_name,
             COUNT(l.id) as loan_count,
             COALESCE(SUM(l.principal_amount), 0) as total_loans
      FROM customers c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN loans l ON c.id = l.customer_id AND l.status = 'active'
    `;
    
    const conditions = [];
    const params = [];
    let paramCount = 0;
    
    // 权限控制：员工只能看自己的客户
    if (req.user.role === 'employee') {
      paramCount++;
      conditions.push(`c.assigned_to = $${paramCount}`);
      params.push(req.user.id);
    }
    
    // 状态筛选
    if (status) {
      paramCount++;
      conditions.push(`c.status = $${paramCount}`);
      params.push(status);
    }
    
    // 搜索功能
    if (search) {
      paramCount++;
      conditions.push(`(
        c.full_name ILIKE $${paramCount} OR 
        c.customer_code ILIKE $${paramCount} OR 
        c.customer_number ILIKE $${paramCount} OR 
        c.phone ILIKE $${paramCount}
      )`);
      params.push(`%${search}%`);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += `
      GROUP BY c.id, u.full_name
      ORDER BY c.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    
    params.push(parseInt(limit), offset);
    
    const result = await pool.query(query, params);
    
    // 获取总数
    let countQuery = 'SELECT COUNT(*) FROM customers c';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = await pool.query(countQuery, params.slice(0, -2));
    
    res.json({
      customers: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('获取客户列表错误:', error);
    res.status(500).json({ message: '获取客户列表失败' });
  }
});

// 获取单个客户详情
router.get('/:id', 
  auth, 
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  dataAccessControl('customers'),
  async (req, res) => {
  try {
    const { id } = req.params;
    
    const customerResult = await pool.query(`
      SELECT c.*, u.full_name as assigned_to_name, creator.full_name as created_by_name
      FROM customers c
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users creator ON c.created_by = creator.id
      WHERE c.id = $1
    `, [id]);
    
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customerResult.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限访问此客户' });
    }
    
    // 获取客户的贷款记录
    const loansResult = await pool.query(`
      SELECT l.*, 
             COUNT(r.id) as repayment_count,
             COALESCE(SUM(CASE WHEN r.status = 'paid' THEN r.paid_amount ELSE 0 END), 0) as total_paid
      FROM loans l
      LEFT JOIN repayments r ON l.id = r.loan_id
      WHERE l.customer_id = $1
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `, [id]);
    
    // 获取附件
    const attachmentsResult = await pool.query(`
      SELECT a.*, u.full_name as upload_by_name
      FROM attachments a
      LEFT JOIN users u ON a.upload_by = u.id
      WHERE a.customer_id = $1
      ORDER BY a.created_at DESC
    `, [id]);
    
    res.json({
      customer: customerResult.rows[0],
      loans: loansResult.rows,
      attachments: attachmentsResult.rows
    });
  } catch (error) {
    console.error('获取客户详情错误:', error);
    res.status(500).json({ message: '获取客户详情失败' });
  }
});

// 创建新客户
router.post('/', 
  auth, 
  requirePermission(PERMISSIONS.CUSTOMER_CREATE),
  validateCustomer, 
  async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { codes } = await generateCustomerCodes();
    
    const {
      full_name, id_number, phone, address, emergency_contact, emergency_phone,
      assigned_to, notes
    } = req.body;
    
    const result = await client.query(`
      INSERT INTO customers (
        customer_code, customer_number, full_name, id_number, phone, address,
        emergency_contact, emergency_phone, assigned_to, created_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      codes.customerCode, codes.customerNumber, full_name, id_number, phone,
      address, emergency_contact, emergency_phone, assigned_to || req.user.id,
      req.user.id, notes
    ]);
    
    await client.query('COMMIT');
    res.status(201).json({
      message: '客户创建成功',
      customer: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('创建客户错误:', error);
    
    if (error.code === '23505') { // 唯一约束违反
      if (error.constraint.includes('id_number')) {
        res.status(400).json({ message: '身份证号已存在' });
      } else if (error.constraint.includes('customer_code')) {
        res.status(400).json({ message: '客户代号已存在' });
      } else {
        res.status(400).json({ message: '客户编号已存在' });
      }
    } else {
      res.status(500).json({ message: '创建客户失败' });
    }
  } finally {
    client.release();
  }
});

// 更新客户信息
router.put('/:id', 
  auth, 
  requirePermission(PERMISSIONS.CUSTOMER_EDIT),
  dataAccessControl('customers'),
  async (req, res) => {
  try {
    const { id } = req.params;
    const {
      full_name, id_number, phone, address, emergency_contact, emergency_phone,
      assigned_to, status, risk_level, is_blacklisted, notes
    } = req.body;
    
    // 检查客户是否存在
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customerResult.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限修改此客户' });
    }
    
    // 需要审批的操作
    const needsApproval = ['assigned_to', 'status', 'risk_level', 'is_blacklisted'];
    const hasApprovalRequiredChanges = needsApproval.some(field => 
      req.body.hasOwnProperty(field) && req.body[field] !== customerResult.rows[0][field]
    );
    
    if (hasApprovalRequiredChanges && req.user.role === 'employee') {
      // 创建审批请求
      await pool.query(`
        INSERT INTO approvals (entity_type, entity_id, action, requested_by, comments)
        VALUES ('customer', $1, 'update', $2, $3)
      `, [id, req.user.id, '客户信息修改需要审批']);
      
      return res.status(202).json({ message: '修改请求已提交，等待审批' });
    }
    
    const result = await pool.query(`
      UPDATE customers SET
        full_name = COALESCE($2, full_name),
        id_number = COALESCE($3, id_number),
        phone = COALESCE($4, phone),
        address = COALESCE($5, address),
        emergency_contact = COALESCE($6, emergency_contact),
        emergency_phone = COALESCE($7, emergency_phone),
        assigned_to = COALESCE($8, assigned_to),
        status = COALESCE($9, status),
        risk_level = COALESCE($10, risk_level),
        is_blacklisted = COALESCE($11, is_blacklisted),
        notes = COALESCE($12, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [
      id, full_name, id_number, phone, address, emergency_contact,
      emergency_phone, assigned_to, status, risk_level, is_blacklisted, notes
    ]);
    
    res.json({
      message: '客户信息更新成功',
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('更新客户错误:', error);
    res.status(500).json({ message: '更新客户信息失败' });
  }
});

// 删除客户
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查客户是否存在
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customerResult.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限删除此客户' });
    }
    
    // 检查是否有活跃贷款
    const activeLoansResult = await pool.query(
      'SELECT COUNT(*) FROM loans WHERE customer_id = $1 AND status = $2',
      [id, 'active']
    );
    
    if (parseInt(activeLoansResult.rows[0].count) > 0) {
      return res.status(400).json({ message: '客户有活跃贷款，无法删除' });
    }
    
    // 需要审批
    if (req.user.role === 'employee') {
      await pool.query(`
        INSERT INTO approvals (entity_type, entity_id, action, requested_by, comments)
        VALUES ('customer', $1, 'delete', $2, $3)
      `, [id, req.user.id, '客户删除需要审批']);
      
      return res.status(202).json({ message: '删除请求已提交，等待审批' });
    }
    
    await pool.query('DELETE FROM customers WHERE id = $1', [id]);
    res.json({ message: '客户删除成功' });
  } catch (error) {
    console.error('删除客户错误:', error);
    res.status(500).json({ message: '删除客户失败' });
  }
});

// 获取客户状态统计
router.get('/stats/status', auth, async (req, res) => {
  try {
    let query = `
      SELECT status, COUNT(*) as count
      FROM customers
    `;
    
    const params = [];
    let paramCount = 0;
    
    // 权限控制
    if (req.user.role === 'employee') {
      paramCount++;
      query += ` WHERE assigned_to = $${paramCount}`;
      params.push(req.user.id);
    }
    
    query += ' GROUP BY status ORDER BY status';
    
    const result = await pool.query(query, params);
    
    const stats = {
      normal: 0,
      cleared: 0,
      negotiating: 0,
      bad_debt: 0
    };
    
    result.rows.forEach(row => {
      stats[row.status] = parseInt(row.count);
    });
    
    res.json(stats);
  } catch (error) {
    console.error('获取客户状态统计错误:', error);
    res.status(500).json({ message: '获取统计信息失败' });
  }
});

// 更新客户状态
router.put('/:id/status', 
  auth, 
  requirePermission(PERMISSIONS.CUSTOMER_EDIT),
  dataAccessControl('customers'),
  async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // 验证状态值
    const validStatuses = ['normal', 'cleared', 'negotiating', 'bad_debt'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        message: '无效的客户状态'
      });
    }
    
    const result = await pool.query(
      'UPDATE customers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        message: '客户不存在'
      });
    }
    
    res.json({ 
      message: '客户状态更新成功',
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('更新客户状态失败:', error);
    res.status(500).json({ message: '更新客户状态失败' });
  }
});

module.exports = router;
