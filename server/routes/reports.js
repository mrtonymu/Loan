const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { auth } = require('../middleware/auth_supabase');
const { 
  requirePermission, 
  requireAnyPermission,
  isManagerOrAdmin,
  PERMISSIONS 
} = require('../middleware/permissions');
const { generateMonthlySnapshot } = require('../utils/loanCalculator');

// 生成月度快照
router.post('/monthly-snapshot', 
  auth, 
  requirePermission(PERMISSIONS.REPORT_FINANCIAL),
  async (req, res) => {
  try {
    const { snapshot_date } = req.body;
    const date = snapshot_date ? new Date(snapshot_date) : new Date();
    
    // 调用数据库函数生成快照
    const result = await pool.query('SELECT generate_monthly_snapshot($1)', [date]);
    
    res.json({
      success: true,
      message: '月度快照生成成功',
      data: { snapshot_date: date.toISOString().split('T')[0] }
    });
  } catch (error) {
    console.error('Error generating monthly snapshot:', error);
    res.status(500).json({ success: false, message: '生成月度快照失败' });
  }
});

// 获取月度快照列表
router.get('/monthly-snapshots', auth, async (req, res) => {
  try {
    const { page = 1, limit = 12, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const queryParams = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      whereClause += ` WHERE snapshot_date >= $${paramCount}`;
      queryParams.push(start_date);
    }

    if (end_date) {
      paramCount++;
      whereClause += whereClause ? ` AND snapshot_date <= $${paramCount}` : ` WHERE snapshot_date <= $${paramCount}`;
      queryParams.push(end_date);
    }

    const query = `
      SELECT *
      FROM monthly_snapshots
      ${whereClause}
      ORDER BY snapshot_date DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(parseInt(limit), offset);

    const result = await pool.query(query, queryParams);

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM monthly_snapshots ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching monthly snapshots:', error);
    res.status(500).json({ success: false, message: '获取月度快照失败' });
  }
});

// 获取财务报表
router.get('/financial', auth, async (req, res) => {
  try {
    const { period = 'month', start_date, end_date } = req.query;
    
    let dateFilter = '';
    const queryParams = [];
    let paramCount = 0;

    if (start_date && end_date) {
      paramCount += 2;
      dateFilter = `WHERE l.created_at >= $1 AND l.created_at <= $2`;
      queryParams.push(start_date, end_date);
    } else if (period === 'month') {
      dateFilter = `WHERE l.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
    } else if (period === 'quarter') {
      dateFilter = `WHERE l.created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
    } else if (period === 'year') {
      dateFilter = `WHERE l.created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
    }

    const query = `
      SELECT 
        -- 放款统计
        COUNT(*) as total_loans,
        COALESCE(SUM(l.principal_amount), 0) as total_principal,
        COALESCE(SUM(l.received_amount), 0) as total_received,
        COALESCE(SUM(l.deposit_amount), 0) as total_deposits,
        
        -- 还款统计
        COALESCE(SUM(r.paid_amount), 0) as total_repayments,
        COALESCE(SUM(r.paid_principal), 0) as total_principal_paid,
        COALESCE(SUM(r.paid_interest), 0) as total_interest_paid,
        COALESCE(SUM(r.paid_fees), 0) as total_fees_paid,
        
        -- 逾期统计
        COUNT(CASE WHEN l.overdue_days > 0 THEN 1 END) as overdue_loans,
        COALESCE(SUM(CASE WHEN l.overdue_days > 0 THEN l.overdue_amount END), 0) as overdue_amount,
        COALESCE(SUM(CASE WHEN l.overdue_days > 0 THEN l.overdue_fees END), 0) as overdue_fees,
        
        -- 状态统计
        COUNT(CASE WHEN l.status = 'active' THEN 1 END) as active_loans,
        COUNT(CASE WHEN l.status = 'completed' THEN 1 END) as completed_loans,
        COUNT(CASE WHEN l.status = 'bad_debt' THEN 1 END) as bad_debt_loans,
        
        -- 风险等级统计
        COUNT(CASE WHEN l.risk_level = 'low' THEN 1 END) as low_risk_loans,
        COUNT(CASE WHEN l.risk_level = 'medium' THEN 1 END) as medium_risk_loans,
        COUNT(CASE WHEN l.risk_level = 'high' THEN 1 END) as high_risk_loans,
        COUNT(CASE WHEN l.risk_level = 'critical' THEN 1 END) as critical_risk_loans
      FROM loans l
      LEFT JOIN repayments r ON l.id = r.loan_id
      ${dateFilter}
    `;

    const result = await pool.query(query, queryParams);
    const stats = result.rows[0];

    // 计算ROI
    const roi = stats.total_principal > 0 ? 
      ((stats.total_repayments - stats.total_principal) / stats.total_principal * 100) : 0;

    // 计算回收率
    const recoveryRate = stats.total_principal > 0 ? 
      (stats.total_repayments / stats.total_principal * 100) : 0;

    res.json({
      success: true,
      data: {
        ...stats,
        roi: parseFloat(roi.toFixed(2)),
        recovery_rate: parseFloat(recoveryRate.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Error fetching financial report:', error);
    res.status(500).json({ success: false, message: '获取财务报表失败' });
  }
});

// 获取客户分析报告
router.get('/customer-analysis', auth, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    let dateFilter = '';
    if (period === 'month') {
      dateFilter = `WHERE c.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
    } else if (period === 'quarter') {
      dateFilter = `WHERE c.created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
    } else if (period === 'year') {
      dateFilter = `WHERE c.created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
    }

    const query = `
      SELECT 
        -- 客户统计
        COUNT(*) as total_customers,
        COUNT(CASE WHEN c.status = 'normal' THEN 1 END) as normal_customers,
        COUNT(CASE WHEN c.status = 'negotiating' THEN 1 END) as negotiating_customers,
        COUNT(CASE WHEN c.status = 'bad_debt' THEN 1 END) as bad_debt_customers,
        COUNT(CASE WHEN c.blacklist_status = true THEN 1 END) as blacklisted_customers,
        
        -- 逾期统计
        COUNT(CASE WHEN c.overdue_count > 0 THEN 1 END) as customers_with_overdue,
        COALESCE(AVG(c.overdue_count), 0) as avg_overdue_count,
        COALESCE(MAX(c.max_overdue_days), 0) as max_overdue_days,
        
        -- 贷款统计
        COALESCE(SUM(l.principal_amount), 0) as total_loan_amount,
        COALESCE(AVG(l.principal_amount), 0) as avg_loan_amount,
        COUNT(l.id) as total_loans
      FROM customers c
      LEFT JOIN loans l ON c.id = l.customer_id
      ${dateFilter}
      GROUP BY c.id
    `;

    const result = await pool.query(query);
    
    // 计算汇总数据
    const summary = {
      total_customers: result.rows.length,
      normal_customers: result.rows.filter(r => r.normal_customers > 0).length,
      negotiating_customers: result.rows.filter(r => r.negotiating_customers > 0).length,
      bad_debt_customers: result.rows.filter(r => r.bad_debt_customers > 0).length,
      blacklisted_customers: result.rows.filter(r => r.blacklisted_customers > 0).length,
      customers_with_overdue: result.rows.filter(r => r.customers_with_overdue > 0).length,
      avg_overdue_count: result.rows.reduce((sum, r) => sum + r.avg_overdue_count, 0) / result.rows.length || 0,
      max_overdue_days: Math.max(...result.rows.map(r => r.max_overdue_days), 0),
      total_loan_amount: result.rows.reduce((sum, r) => sum + parseFloat(r.total_loan_amount), 0),
      avg_loan_amount: result.rows.reduce((sum, r) => sum + parseFloat(r.avg_loan_amount), 0) / result.rows.length || 0,
      total_loans: result.rows.reduce((sum, r) => sum + parseInt(r.total_loans), 0)
    };

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Error fetching customer analysis:', error);
    res.status(500).json({ success: false, message: '获取客户分析报告失败' });
  }
});

// 获取员工绩效报告
router.get('/employee-performance', auth, async (req, res) => {
  try {
    const { period = 'month', employee_id } = req.query;
    
    let dateFilter = '';
    let employeeFilter = '';
    const queryParams = [];
    let paramCount = 0;

    if (period === 'month') {
      dateFilter = `AND l.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
    } else if (period === 'quarter') {
      dateFilter = `AND l.created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
    } else if (period === 'year') {
      dateFilter = `AND l.created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
    }

    if (employee_id) {
      paramCount++;
      employeeFilter = `AND l.created_by = $${paramCount}`;
      queryParams.push(employee_id);
    }

    const query = `
      SELECT 
        u.id,
        u.username,
        u.full_name,
        COUNT(l.id) as total_loans,
        COALESCE(SUM(l.principal_amount), 0) as total_loan_amount,
        COALESCE(AVG(l.principal_amount), 0) as avg_loan_amount,
        COUNT(CASE WHEN l.status = 'completed' THEN 1 END) as completed_loans,
        COUNT(CASE WHEN l.overdue_days > 0 THEN 1 END) as overdue_loans,
        COALESCE(SUM(r.paid_amount), 0) as total_collections,
        COALESCE(SUM(r.paid_amount) / NULLIF(SUM(l.principal_amount), 0) * 100, 0) as collection_rate
      FROM users u
      LEFT JOIN loans l ON u.id = l.created_by ${dateFilter} ${employeeFilter}
      LEFT JOIN repayments r ON l.id = r.loan_id
      WHERE u.role IN ('employee', 'secretary', 'manager')
      GROUP BY u.id, u.username, u.full_name
      ORDER BY total_loan_amount DESC
    `;

    const result = await pool.query(query, queryParams);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        collection_rate: parseFloat(row.collection_rate.toFixed(2))
      }))
    });
  } catch (error) {
    console.error('Error fetching employee performance:', error);
    res.status(500).json({ success: false, message: '获取员工绩效报告失败' });
  }
});

// 导出Excel报表
router.get('/export/excel', auth, async (req, res) => {
  try {
    const { type, period = 'month', start_date, end_date } = req.query;
    
    // 这里应该使用Excel导出库，如xlsx
    // 为了简化，我们返回JSON数据，前端可以处理Excel导出
    
    let reportData = {};
    
    if (type === 'financial') {
      const response = await pool.query(`
        SELECT 
          l.loan_number,
          c.full_name as customer_name,
          l.principal_amount,
          l.received_amount,
          l.status,
          l.overdue_days,
          l.overdue_amount,
          l.created_at
        FROM loans l
        JOIN customers c ON l.customer_id = c.id
        WHERE l.created_at >= $1 AND l.created_at <= $2
        ORDER BY l.created_at DESC
      `, [start_date || new Date().toISOString().split('T')[0], end_date || new Date().toISOString().split('T')[0]]);
      
      reportData = response.rows;
    }
    
    res.json({
      success: true,
      data: reportData,
      message: '数据准备完成，请在前端处理Excel导出'
    });
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ success: false, message: '导出报表失败' });
  }
});

// 获取审计日志
router.get('/audit-logs', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, entity_type, action, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramCount = 0;

    if (entity_type) {
      paramCount++;
      whereClause += ` AND entity_type = $${paramCount}`;
      queryParams.push(entity_type);
    }

    if (action) {
      paramCount++;
      whereClause += ` AND action = $${paramCount}`;
      queryParams.push(action);
    }

    if (start_date) {
      paramCount++;
      whereClause += ` AND created_at >= $${paramCount}`;
      queryParams.push(start_date);
    }

    if (end_date) {
      paramCount++;
      whereClause += ` AND created_at <= $${paramCount}`;
      queryParams.push(end_date);
    }

    const query = `
      SELECT 
        al.*,
        u.username as user_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(parseInt(limit), offset);

    const result = await pool.query(query, queryParams);

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, message: '获取审计日志失败' });
  }
});

module.exports = router;
