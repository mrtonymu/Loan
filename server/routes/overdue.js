const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { auth } = require('../middleware/auth_supabase');
// 权限中间件暂时移除，简化迁移过程
const { 
  calculateOverdueDays, 
  calculateOverdueFees, 
  calculateRiskLevel, 
  generateCollectionAdvice,
  calculateCreditScore
} = require('../utils/loanCalculator');

// 获取逾期贷款列表
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, risk_level, days_min, days_max } = req.query;
    const offset = (page - 1) * limit;

    // 构建查询 - 暂时获取所有贷款，稍后添加逾期过滤
    let loanQuery = supabase
      .from('loans')
      .select(`
        *,
        customers!inner(full_name, phone, blacklist_status, overdue_count, max_overdue_days, assigned_to)
      `);

    // 权限控制
    if (req.user.role === 'employee') {
      loanQuery = loanQuery.eq('customers.assigned_to', req.user.id);
    }

    // 状态筛选
    if (status) {
      loanQuery = loanQuery.eq('status', status);
    }

    // 风险等级筛选
    if (risk_level) {
      loanQuery = loanQuery.eq('risk_level', risk_level);
    }

    // 逾期天数筛选
    if (days_min) {
      loanQuery = loanQuery.gte('overdue_days', parseInt(days_min));
    }

    if (days_max) {
      loanQuery = loanQuery.lte('overdue_days', parseInt(days_max));
    }

    // 分页和排序
    loanQuery = loanQuery
      .order('overdue_days', { ascending: false })
      .order('overdue_amount', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: loans, error: loanError, count: totalCount } = await loanQuery;

    if (loanError) {
      console.error('获取逾期贷款错误:', loanError);
      return res.status(500).json({ success: false, message: '获取逾期贷款失败' });
    }

    // 格式化数据
    const formattedLoans = loans?.map(loan => ({
      ...loan,
      customer_name: loan.customers?.full_name,
      phone: loan.customers?.phone,
      blacklist_status: loan.customers?.blacklist_status,
      overdue_count: loan.customers?.overdue_count,
      max_overdue_days: loan.customers?.max_overdue_days
    })) || [];

    res.json({
      success: true,
      data: formattedLoans,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount || 0,
        pages: Math.ceil((totalCount || 0) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching overdue loans:', error);
    res.status(500).json({ success: false, message: '获取逾期贷款失败' });
  }
});

// 获取逾期统计
router.get('/stats', auth, async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_overdue,
        COUNT(CASE WHEN l.overdue_days <= 30 THEN 1 END) as early_overdue,
        COUNT(CASE WHEN l.overdue_days > 30 AND l.overdue_days <= 90 THEN 1 END) as late_overdue,
        COUNT(CASE WHEN l.overdue_days > 90 THEN 1 END) as bad_debt,
        COALESCE(SUM(l.overdue_amount), 0) as total_overdue_amount,
        COALESCE(SUM(l.overdue_fees), 0) as total_overdue_fees,
        COALESCE(AVG(l.overdue_days), 0) as avg_overdue_days
      FROM loans l
      WHERE l.overdue_days > 0
    `;

    const result = await pool.query(statsQuery);
    const stats = result.rows[0];

    // 获取风险等级分布
    const riskQuery = `
      SELECT 
        risk_level,
        COUNT(*) as count,
        COALESCE(SUM(overdue_amount), 0) as amount
      FROM loans
      WHERE overdue_days > 0
      GROUP BY risk_level
    `;

    const riskResult = await pool.query(riskQuery);

    res.json({
      success: true,
      data: {
        ...stats,
        risk_distribution: riskResult.rows
      }
    });
  } catch (error) {
    console.error('Error fetching overdue stats:', error);
    res.status(500).json({ success: false, message: '获取逾期统计失败' });
  }
});

// 更新逾期状态
router.post('/:id/update-status', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const updateQuery = `
      UPDATE loans 
      SET status = $1, status_reason = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [status, reason, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '贷款记录不存在' });
    }

    res.json({
      success: true,
      message: '状态更新成功',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating loan status:', error);
    res.status(500).json({ success: false, message: '更新状态失败' });
  }
});

// 添加催收记录
router.post('/:id/collection', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      collection_type, 
      collection_method, 
      contact_person, 
      contact_info, 
      result, 
      notes, 
      next_follow_up_date 
    } = req.body;

    // 获取贷款信息
    const loanQuery = 'SELECT customer_id FROM loans WHERE id = $1';
    const loanResult = await pool.query(loanQuery, [id]);

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: '贷款记录不存在' });
    }

    const customerId = loanResult.rows[0].customer_id;

    const insertQuery = `
      INSERT INTO collection_records (
        loan_id, customer_id, collection_type, collection_method,
        contact_person, contact_info, result, notes, next_follow_up_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const insertResult = await pool.query(insertQuery, [
      id, customerId, collection_type, collection_method,
      contact_person, contact_info, result, notes, next_follow_up_date, req.user.id
    ]);

    res.json({
      success: true,
      message: '催收记录添加成功',
      data: insertResult.rows[0]
    });
  } catch (error) {
    console.error('Error adding collection record:', error);
    res.status(500).json({ success: false, message: '添加催收记录失败' });
  }
});

// 获取催收记录
router.get('/:id/collection', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        cr.*,
        u.username as created_by_name
      FROM collection_records cr
      LEFT JOIN users u ON cr.created_by = u.id
      WHERE cr.loan_id = $1
      ORDER BY cr.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [id, parseInt(limit), offset]);

    // 获取总数
    const countQuery = 'SELECT COUNT(*) as total FROM collection_records WHERE loan_id = $1';
    const countResult = await pool.query(countQuery, [id]);

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
    console.error('Error fetching collection records:', error);
    res.status(500).json({ success: false, message: '获取催收记录失败' });
  }
});

// 获取催收建议
router.get('/:id/advice', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        l.*,
        c.overdue_count,
        c.max_overdue_days,
        c.blacklist_status
      FROM loans l
      JOIN customers c ON l.customer_id = c.id
      WHERE l.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '贷款记录不存在' });
    }

    const loan = result.rows[0];
    
    // 计算风险等级
    const riskLevel = calculateRiskLevel({
      overdueDays: loan.overdue_days,
      overdueCount: loan.overdue_count,
      loanAmount: loan.principal_amount,
      isBlacklisted: loan.blacklist_status
    });

    // 计算逾期费用
    const overdueFees = calculateOverdueFees({
      overdueDays: loan.overdue_days,
      overdueAmount: loan.overdue_amount,
      dailyPenaltyRate: 0.1,
      fixedPenalty: 50
    });

    // 生成催收建议
    const advice = generateCollectionAdvice({
      overdueDays: loan.overdue_days,
      riskLevel: riskLevel,
      overdueAmount: loan.overdue_amount
    });

    // 计算信用评分
    const creditScore = calculateCreditScore({
      overdueCount: loan.overdue_count,
      maxOverdueDays: loan.max_overdue_days,
      totalLoans: 1, // 简化处理
      successfulLoans: loan.overdue_count === 0 ? 1 : 0,
      isBlacklisted: loan.blacklist_status
    });

    res.json({
      success: true,
      data: {
        loan: loan,
        riskLevel: riskLevel,
        overdueFees: overdueFees,
        collectionAdvice: advice,
        creditScore: creditScore
      }
    });
  } catch (error) {
    console.error('Error generating collection advice:', error);
    res.status(500).json({ success: false, message: '生成催收建议失败' });
  }
});

// 批量更新逾期状态
router.post('/batch-update', auth, async (req, res) => {
  try {
    const { loan_ids, status, reason } = req.body;

    if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要更新的贷款' });
    }

    const updateQuery = `
      UPDATE loans 
      SET status = $1, status_reason = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($3)
      RETURNING id, status
    `;

    const result = await pool.query(updateQuery, [status, reason, loan_ids]);

    res.json({
      success: true,
      message: `成功更新 ${result.rows.length} 条记录`,
      data: result.rows
    });
  } catch (error) {
    console.error('Error batch updating loans:', error);
    res.status(500).json({ success: false, message: '批量更新失败' });
  }
});

module.exports = router;
