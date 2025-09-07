const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { auth } = require('../middleware/auth_supabase');

// 获取Dashboard概览数据
router.get('/overview', auth, async (req, res) => {
  try {
    const { period = 'month' } = req.query; // month, quarter, year
    
    // 计算时间范围
    let startDate;
    const now = new Date();
    
    if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    } else if (period === 'quarter') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    }
    
    // 权限控制
    let customerQuery = supabase.from('customers').select('*');
    if (req.user.role === 'employee') {
      customerQuery = customerQuery.eq('assigned_to', req.user.id);
    }
    
    // 获取客户数据
    const { data: customers, error: customerError } = await customerQuery;
    if (customerError) {
      console.error('获取客户数据错误:', customerError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 获取贷款数据
    let loanQuery = supabase.from('loans').select('*');
    if (startDate) {
      loanQuery = loanQuery.gte('created_at', startDate.toISOString());
    }
    
    const { data: loans, error: loanError } = await loanQuery;
    if (loanError) {
      console.error('获取贷款数据错误:', loanError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 计算统计数据
    const stats = {
      total_customers: customers?.length || 0,
      total_loans: loans?.length || 0,
      total_principal: loans?.reduce((sum, loan) => sum + (loan.principal_amount || 0), 0) || 0,
      total_amount: loans?.reduce((sum, loan) => sum + (loan.total_amount || 0), 0) || 0,
      total_received: loans?.reduce((sum, loan) => sum + (loan.received_amount || 0), 0) || 0,
      active_loans: loans?.filter(loan => loan.status === 'active').length || 0,
      completed_loans: loans?.filter(loan => loan.status === 'completed').length || 0,
      defaulted_loans: loans?.filter(loan => loan.status === 'defaulted').length || 0
    };
    
    // 客户状态分布
    const customerStatus = {};
    if (customers) {
      customers.forEach(customer => {
        const status = customer.status || 'normal';
        customerStatus[status] = (customerStatus[status] || 0) + 1;
      });
    }
    
    // 获取还款数据
    const { data: repayments, error: repaymentError } = await supabase
      .from('repayments')
      .select('*');
    
    if (repaymentError) {
      console.error('获取还款数据错误:', repaymentError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 计算还款统计
    const repaymentStats = {
      total_paid: repayments?.filter(r => r.status === 'paid')
        .reduce((sum, r) => sum + (r.paid_amount || 0), 0) || 0,
      overdue_amount: repayments?.filter(r => {
        const dueDate = new Date(r.due_date);
        const today = new Date();
        return dueDate < today && r.status === 'pending';
      }).reduce((sum, r) => sum + ((r.total_amount || 0) - (r.paid_amount || 0)), 0) || 0,
      overdue_count: repayments?.filter(r => {
        const dueDate = new Date(r.due_date);
        const today = new Date();
        return dueDate < today && r.status === 'pending';
      }).length || 0
    };
    
    // 计算ROI
    const roi = stats.total_principal > 0 ? 
      ((repaymentStats.total_paid - stats.total_principal) / stats.total_principal * 100) : 0;
    
    // 月度趋势数据
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const { data: trendLoans, error: trendError } = await supabase
      .from('loans')
      .select('*')
      .gte('created_at', twelveMonthsAgo.toISOString());
    
    if (trendError) {
      console.error('获取趋势数据错误:', trendError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 按月份分组趋势数据
    const trends = {};
    if (trendLoans) {
      trendLoans.forEach(loan => {
        const month = new Date(loan.created_at).toISOString().substring(0, 7); // YYYY-MM
        if (!trends[month]) {
          trends[month] = { loan_count: 0, loan_amount: 0 };
        }
        trends[month].loan_count++;
        trends[month].loan_amount += loan.principal_amount || 0;
      });
    }
    
    const trendResult = Object.entries(trends).map(([month, data]) => ({
      month: month + '-01T00:00:00.000Z',
      loan_count: data.loan_count,
      loan_amount: data.loan_amount
    })).sort((a, b) => a.month.localeCompare(b.month));
    
    res.json({
      overview: {
        ...stats,
        total_paid: parseFloat(repaymentStats.total_paid),
        overdue_amount: parseFloat(repaymentStats.overdue_amount),
        overdue_count: parseInt(repaymentStats.overdue_count),
        roi: Math.round(roi * 100) / 100,
        statusDistribution: customerStatus
      },
      stats: {
        ...stats,
        total_paid: parseFloat(repaymentStats.total_paid),
        overdue_amount: parseFloat(repaymentStats.overdue_amount),
        overdue_count: parseInt(repaymentStats.overdue_count),
        roi: Math.round(roi * 100) / 100
      },
      customerStatus,
      trends: trendResult.map(row => ({
        month: row.month.split('T')[0],
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
