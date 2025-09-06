const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { auth } = require('../middleware/auth');

// 获取Dashboard概览数据
router.get('/overview', auth, async (req, res) => {
  try {
    const { period = 'month' } = req.query; // month, quarter, year
    
    // 计算时间范围
    let dateFilter = '';
    const params = [];
    let paramCount = 0;
    
    if (period === 'month') {
      paramCount++;
      dateFilter = `AND l.created_at >= CURRENT_DATE - INTERVAL '1 month'`;
    } else if (period === 'quarter') {
      paramCount++;
      dateFilter = `AND l.created_at >= CURRENT_DATE - INTERVAL '3 months'`;
    } else if (period === 'year') {
      paramCount++;
      dateFilter = `AND l.created_at >= CURRENT_DATE - INTERVAL '1 year'`;
    }
    
    // 权限控制
    let permissionFilter = '';
    if (req.user.role === 'employee') {
      paramCount++;
      permissionFilter = `AND c.assigned_to = $${paramCount}`;
      params.push(req.user.id);
    }
    
    // 基础统计
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT c.id) as total_customers,
        COUNT(DISTINCT l.id) as total_loans,
        COALESCE(SUM(l.principal_amount), 0) as total_principal,
        COALESCE(SUM(l.total_amount), 0) as total_amount,
        COALESCE(SUM(l.received_amount), 0) as total_received,
        COUNT(CASE WHEN l.status = 'active' THEN 1 END) as active_loans,
        COUNT(CASE WHEN l.status = 'completed' THEN 1 END) as completed_loans,
        COUNT(CASE WHEN l.status = 'defaulted' THEN 1 END) as defaulted_loans
      FROM customers c
      LEFT JOIN loans l ON c.id = l.customer_id ${dateFilter}
      WHERE 1=1 ${permissionFilter}
    `;
    
    const statsResult = await pool.query(statsQuery, params);
    const stats = statsResult.rows[0];
    
    // 客户状态分布
    const customerStatusQuery = `
      SELECT 
        status,
        COUNT(*) as count
      FROM customers c
      WHERE 1=1 ${permissionFilter}
      GROUP BY status
    `;
    
    const customerStatusResult = await pool.query(customerStatusQuery, params.slice(0, -1));
    const customerStatus = {};
    customerStatusResult.rows.forEach(row => {
      customerStatus[row.status] = parseInt(row.count);
    });
    
    // 还款统计
    const repaymentQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN r.status = 'paid' THEN r.paid_amount ELSE 0 END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN r.due_date < CURRENT_DATE AND r.status = 'pending' THEN r.total_amount - r.paid_amount ELSE 0 END), 0) as overdue_amount,
        COUNT(CASE WHEN r.due_date < CURRENT_DATE AND r.status = 'pending' THEN 1 END) as overdue_count
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE 1=1 ${permissionFilter}
    `;
    
    const repaymentResult = await pool.query(repaymentQuery, params.slice(0, -1));
    const repaymentStats = repaymentResult.rows[0];
    
    // 计算ROI
    const roi = stats.total_principal > 0 ? 
      ((parseFloat(repaymentStats.total_paid) - parseFloat(stats.total_principal)) / parseFloat(stats.total_principal) * 100) : 0;
    
    // 月度趋势数据
    const trendQuery = `
      SELECT 
        DATE_TRUNC('month', l.created_at) as month,
        COUNT(l.id) as loan_count,
        COALESCE(SUM(l.principal_amount), 0) as loan_amount
      FROM loans l
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE l.created_at >= CURRENT_DATE - INTERVAL '12 months' ${permissionFilter}
      GROUP BY DATE_TRUNC('month', l.created_at)
      ORDER BY month
    `;
    
    const trendResult = await pool.query(trendQuery, params.slice(0, -1));
    
    res.json({
      stats: {
        ...stats,
        total_paid: parseFloat(repaymentStats.total_paid),
        overdue_amount: parseFloat(repaymentStats.overdue_amount),
        overdue_count: parseInt(repaymentStats.overdue_count),
        roi: Math.round(roi * 100) / 100
      },
      customerStatus,
      trends: trendResult.rows.map(row => ({
        month: row.month.toISOString().split('T')[0],
        loan_count: parseInt(row.loan_count),
        loan_amount: parseFloat(row.loan_amount)
      }))
    });
  } catch (error) {
    console.error('获取Dashboard数据错误:', error);
    res.status(500).json({ message: '获取Dashboard数据失败' });
  }
});

// 获取逾期客户列表
router.get('/overdue', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT DISTINCT
        c.id, c.customer_code, c.full_name, c.phone, c.status,
        l.loan_number, l.principal_amount,
        COUNT(r.id) as overdue_count,
        COALESCE(SUM(r.total_amount - r.paid_amount), 0) as overdue_amount,
        MAX(r.due_date) as latest_overdue_date
      FROM customers c
      LEFT JOIN loans l ON c.id = l.customer_id AND l.status = 'active'
      LEFT JOIN repayments r ON l.id = r.loan_id AND r.due_date < CURRENT_DATE AND r.status = 'pending'
    `;
    
    const conditions = ['r.id IS NOT NULL'];
    const params = [];
    let paramCount = 0;
    
    // 权限控制
    if (req.user.role === 'employee') {
      paramCount++;
      conditions.push(`c.assigned_to = $${paramCount}`);
      params.push(req.user.id);
    }
    
    query += ` WHERE ${conditions.join(' AND ')}`;
    query += `
      GROUP BY c.id, c.customer_code, c.full_name, c.phone, c.status, l.loan_number, l.principal_amount
      ORDER BY latest_overdue_date DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    
    params.push(parseInt(limit), offset);
    
    const result = await pool.query(query, params);
    
    // 获取总数
    let countQuery = `
      SELECT COUNT(DISTINCT c.id)
      FROM customers c
      LEFT JOIN loans l ON c.id = l.customer_id AND l.status = 'active'
      LEFT JOIN repayments r ON l.id = r.loan_id AND r.due_date < CURRENT_DATE AND r.status = 'pending'
      WHERE r.id IS NOT NULL
    `;
    
    if (req.user.role === 'employee') {
      countQuery += ` AND c.assigned_to = $1`;
    }
    
    const countResult = await pool.query(countQuery, req.user.role === 'employee' ? [req.user.id] : []);
    
    res.json({
      overdue_customers: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('获取逾期客户错误:', error);
    res.status(500).json({ message: '获取逾期客户失败' });
  }
});

// 获取最近活动
router.get('/recent-activity', auth, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    let query = `
      SELECT 
        'loan' as type,
        l.id,
        l.loan_number as reference,
        c.full_name as customer_name,
        l.principal_amount as amount,
        l.created_at as activity_date,
        u.full_name as created_by_name
      FROM loans l
      LEFT JOIN customers c ON l.customer_id = c.id
      LEFT JOIN users u ON l.created_by = u.id
    `;
    
    const conditions = [];
    const params = [];
    let paramCount = 0;
    
    // 权限控制
    if (req.user.role === 'employee') {
      paramCount++;
      conditions.push(`c.assigned_to = $${paramCount}`);
      params.push(req.user.id);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += `
      UNION ALL
      SELECT 
        'repayment' as type,
        r.id,
        CONCAT('还款 #', r.repayment_number) as reference,
        c.full_name as customer_name,
        r.paid_amount as amount,
        r.payment_date as activity_date,
        u.full_name as created_by_name
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      LEFT JOIN users u ON l.created_by = u.id
      WHERE r.status = 'paid'
    `;
    
    if (req.user.role === 'employee') {
      paramCount++;
      query += ` AND c.assigned_to = $${paramCount}`;
      params.push(req.user.id);
    }
    
    query += `
      ORDER BY activity_date DESC
      LIMIT $${paramCount + 1}
    `;
    
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    
    res.json({
      activities: result.rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
        activity_date: row.activity_date.toISOString()
      }))
    });
  } catch (error) {
    console.error('获取最近活动错误:', error);
    res.status(500).json({ message: '获取最近活动失败' });
  }
});

// 获取员工绩效统计
router.get('/employee-performance', auth, async (req, res) => {
  try {
    // 只有经理和管理员可以查看
    if (!['manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    
    const query = `
      SELECT 
        u.id, u.full_name, u.role,
        COUNT(DISTINCT c.id) as customer_count,
        COUNT(DISTINCT l.id) as loan_count,
        COALESCE(SUM(l.principal_amount), 0) as total_principal,
        COALESCE(SUM(CASE WHEN l.status = 'completed' THEN l.principal_amount ELSE 0 END), 0) as completed_principal,
        COALESCE(SUM(CASE WHEN l.status = 'defaulted' THEN l.principal_amount ELSE 0 END), 0) as defaulted_principal,
        COALESCE(SUM(r.paid_amount), 0) as total_collected
      FROM users u
      LEFT JOIN customers c ON u.id = c.assigned_to
      LEFT JOIN loans l ON c.id = l.customer_id
      LEFT JOIN repayments r ON l.id = r.loan_id AND r.status = 'paid'
      WHERE u.role = 'employee' AND u.is_active = true
      GROUP BY u.id, u.full_name, u.role
      ORDER BY total_principal DESC
    `;
    
    const result = await pool.query(query);
    
    const performance = result.rows.map(row => {
      const completionRate = row.total_principal > 0 ? 
        (row.completed_principal / row.total_principal * 100) : 0;
      const defaultRate = row.total_principal > 0 ? 
        (row.defaulted_principal / row.total_principal * 100) : 0;
      const collectionRate = row.total_principal > 0 ? 
        (row.total_collected / row.total_principal * 100) : 0;
      
      return {
        ...row,
        total_principal: parseFloat(row.total_principal),
        completed_principal: parseFloat(row.completed_principal),
        defaulted_principal: parseFloat(row.defaulted_principal),
        total_collected: parseFloat(row.total_collected),
        completion_rate: Math.round(completionRate * 100) / 100,
        default_rate: Math.round(defaultRate * 100) / 100,
        collection_rate: Math.round(collectionRate * 100) / 100
      };
    });
    
    res.json({ performance });
  } catch (error) {
    console.error('获取员工绩效错误:', error);
    res.status(500).json({ message: '获取员工绩效失败' });
  }
});

module.exports = router;
