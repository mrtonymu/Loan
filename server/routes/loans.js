const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { auth } = require('../middleware/auth_supabase');
const { validateLoan } = require('../middleware/validation');
const { calculateLoanAmounts, generateRepaymentSchedule } = require('../utils/loanCalculator');

// 生成贷款编号
const generateLoanNumber = async () => {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM loans WHERE EXTRACT(YEAR FROM created_at) = $1 AND EXTRACT(MONTH FROM created_at) = $2',
    [year, month]
  );
  
  const count = parseInt(countResult.rows[0].count) + 1;
  return `L${year}${month}${String(count).padStart(4, '0')}`;
};

// 使用新的贷款计算逻辑

// 使用新的还款计划生成逻辑

// 获取所有贷款
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, customer_id, search } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT l.*, c.full_name as customer_name, c.customer_code, c.phone as customer_phone,
             u.full_name as created_by_name,
             COUNT(r.id) as total_repayments,
             COALESCE(SUM(CASE WHEN r.status = 'paid' THEN r.paid_amount ELSE 0 END), 0) as total_paid,
             COALESCE(SUM(CASE WHEN r.status = 'overdue' THEN 1 ELSE 0 END), 0) as overdue_count
      FROM loans l
      LEFT JOIN customers c ON l.customer_id = c.id
      LEFT JOIN users u ON l.created_by = u.id
      LEFT JOIN repayments r ON l.id = r.loan_id
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
    
    // 状态筛选
    if (status) {
      paramCount++;
      conditions.push(`l.status = $${paramCount}`);
      params.push(status);
    }
    
    // 客户筛选
    if (customer_id) {
      paramCount++;
      conditions.push(`l.customer_id = $${paramCount}`);
      params.push(customer_id);
    }
    
    // 搜索功能
    if (search) {
      paramCount++;
      conditions.push(`(
        l.loan_number ILIKE $${paramCount} OR 
        c.full_name ILIKE $${paramCount} OR 
        c.customer_code ILIKE $${paramCount}
      )`);
      params.push(`%${search}%`);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += `
      GROUP BY l.id, c.full_name, c.customer_code, c.phone, u.full_name
      ORDER BY l.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    
    params.push(parseInt(limit), offset);
    
    const result = await pool.query(query, params);
    
    // 获取总数
    let countQuery = `
      SELECT COUNT(DISTINCT l.id)
      FROM loans l
      LEFT JOIN customers c ON l.customer_id = c.id
    `;
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = await pool.query(countQuery, params.slice(0, -2));
    
    res.json({
      loans: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('获取贷款列表错误:', error);
    res.status(500).json({ message: '获取贷款列表失败' });
  }
});

// 获取单个贷款详情
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const loanResult = await pool.query(`
      SELECT l.*, c.full_name as customer_name, c.customer_code, c.phone as customer_phone,
             c.id_number, c.address, u.full_name as created_by_name
      FROM loans l
      LEFT JOIN customers c ON l.customer_id = c.id
      LEFT JOIN users u ON l.created_by = u.id
      WHERE l.id = $1
    `, [id]);
    
    if (loanResult.rows.length === 0) {
      return res.status(404).json({ message: '贷款不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee') {
      const customerResult = await pool.query(
        'SELECT assigned_to FROM customers WHERE id = $1',
        [loanResult.rows[0].customer_id]
      );
      if (customerResult.rows[0].assigned_to !== req.user.id) {
        return res.status(403).json({ message: '无权限访问此贷款' });
      }
    }
    
    // 获取还款记录
    const repaymentsResult = await pool.query(`
      SELECT * FROM repayments 
      WHERE loan_id = $1 
      ORDER BY repayment_number ASC
    `, [id]);
    
    res.json({
      loan: loanResult.rows[0],
      repayments: repaymentsResult.rows
    });
  } catch (error) {
    console.error('获取贷款详情错误:', error);
    res.status(500).json({ message: '获取贷款详情失败' });
  }
});

// 创建新贷款
router.post('/', auth, validateLoan, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const {
      customer_id, principal_amount, interest_rate, loan_term_months,
      collateral_description, collateral_value, loan_purpose,
      loan_method = 'method1', deposit_amount = 0, upfront_fees = 0
    } = req.body;
    
    // 验证客户是否存在
    const customerResult = await client.query('SELECT * FROM customers WHERE id = $1', [customer_id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customerResult.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限为此客户创建贷款' });
    }
    
    // 检查客户是否有未结清的贷款
    const activeLoanResult = await client.query(
      'SELECT COUNT(*) FROM loans WHERE customer_id = $1 AND status = $2',
      [customer_id, 'active']
    );
    
    if (parseInt(activeLoanResult.rows[0].count) > 0) {
      return res.status(400).json({ message: '客户已有未结清的贷款' });
    }
    
    // 生成贷款编号
    const loanNumber = await generateLoanNumber();
    
    // 使用新的计算逻辑
    const loanData = calculateLoanAmounts({
      principalAmount: principal_amount,
      interestRate: interest_rate,
      loanTermMonths: loan_term_months,
      loanMethod: loan_method,
      depositAmount: deposit_amount,
      upfrontFees: upfront_fees
    });
    
    // 计算到期日期
    const disbursementDate = new Date();
    const maturityDate = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + loan_term_months);
    
    // 创建贷款记录
    const loanResult = await client.query(`
      INSERT INTO loans (
        loan_number, customer_id, principal_amount, interest_rate, loan_term_months,
        monthly_payment, total_amount, received_amount, collateral_description,
        collateral_value, loan_purpose, disbursement_date, maturity_date, created_by,
        loan_method, deposit_amount, upfront_interest, upfront_fees, prepaid_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      loanNumber, customer_id, principal_amount, interest_rate, loan_term_months,
      loanData.monthlyPayment, loanData.totalAmount, loanData.receivedAmount,
      collateral_description, collateral_value, loan_purpose,
      disbursementDate.toISOString().split('T')[0],
      maturityDate.toISOString().split('T')[0],
      req.user.id, loan_method, deposit_amount, loanData.upfrontInterest, upfront_fees, 0
    ]);
    
    const loanId = loanResult.rows[0].id;
    
    // 生成还款计划
    const repayments = generateRepaymentSchedule({
      ...loanData,
      targetAmount: loanData.targetAmount
    });
    
    // 批量插入还款计划
    if (repayments.length > 0) {
      const values = repayments.map((repayment, index) => {
        const offset = index * 7;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
      }).join(', ');
      
      const params = repayments.flatMap(repayment => [
        loanId,
        repayment.repayment_number,
        repayment.due_date,
        repayment.principal_amount,
        repayment.interest_amount,
        repayment.total_amount,
        repayment.remaining_balance
      ]);
      
      await client.query(`
        INSERT INTO repayments (loan_id, repayment_number, due_date, principal_amount, interest_amount, total_amount, remaining_balance)
        VALUES ${values}
      `, params);
    }
    
    // 更新客户的RM金额
    const newRMAmount = customerResult.rows[0].rm_amount + loanData.totalAmount;
    await client.query(
      'UPDATE customers SET rm_amount = $1 WHERE id = $2',
      [newRMAmount, customer_id]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({
      message: '贷款创建成功',
      loan: loanResult.rows[0],
      loanData: {
        receivedAmount: loanData.receivedAmount,
        targetAmount: loanData.targetAmount,
        depositAmount: loanData.depositAmount,
        upfrontInterest: loanData.upfrontInterest
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('创建贷款错误:', error);
    
    if (error.code === '23505') { // 唯一约束违反
      res.status(400).json({ message: '贷款编号已存在' });
    } else {
      res.status(500).json({ message: '创建贷款失败' });
    }
  } finally {
    client.release();
  }
});

// 更新贷款状态
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // 验证状态值
    const validStatuses = ['active', 'completed', 'defaulted', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: '无效的状态值' });
    }
    
    // 检查贷款是否存在
    const loanResult = await pool.query('SELECT * FROM loans WHERE id = $1', [id]);
    if (loanResult.rows.length === 0) {
      return res.status(404).json({ message: '贷款不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee') {
      const customerResult = await pool.query(
        'SELECT assigned_to FROM customers WHERE id = $1',
        [loanResult.rows[0].customer_id]
      );
      if (customerResult.rows[0].assigned_to !== req.user.id) {
        return res.status(403).json({ message: '无权限修改此贷款' });
      }
    }
    
    // 需要审批的操作
    if (['completed', 'defaulted', 'cancelled'].includes(status) && req.user.role === 'employee') {
      await pool.query(`
        INSERT INTO approvals (entity_type, entity_id, action, requested_by, comments)
        VALUES ('loan', $1, 'update', $2, $3)
      `, [id, req.user.id, `贷款状态修改为${status}需要审批`]);
      
      return res.status(202).json({ message: '状态修改请求已提交，等待审批' });
    }
    
    const result = await pool.query(
      'UPDATE loans SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    res.json({
      message: '贷款状态更新成功',
      loan: result.rows[0]
    });
  } catch (error) {
    console.error('更新贷款状态错误:', error);
    res.status(500).json({ message: '更新贷款状态失败' });
  }
});

// 获取贷款统计
router.get('/stats/overview', auth, async (req, res) => {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_loans,
        COALESCE(SUM(principal_amount), 0) as total_principal,
        COALESCE(SUM(total_amount), 0) as total_amount,
        COALESCE(SUM(received_amount), 0) as total_received,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_loans,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_loans,
        COUNT(CASE WHEN status = 'defaulted' THEN 1 END) as defaulted_loans
      FROM loans l
      LEFT JOIN customers c ON l.customer_id = c.id
    `;
    
    const params = [];
    let paramCount = 0;
    
    // 权限控制
    if (req.user.role === 'employee') {
      paramCount++;
      query += ` WHERE c.assigned_to = $${paramCount}`;
      params.push(req.user.id);
    }
    
    const result = await pool.query(query, params);
    const stats = result.rows[0];
    
    // 计算ROI
    const totalPaid = await pool.query(`
      SELECT COALESCE(SUM(paid_amount), 0) as total_paid
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE r.status = 'paid'${req.user.role === 'employee' ? ' AND c.assigned_to = $1' : ''}
    `, req.user.role === 'employee' ? [req.user.id] : []);
    
    const roi = stats.total_principal > 0 ? 
      ((parseFloat(totalPaid.rows[0].total_paid) - parseFloat(stats.total_principal)) / parseFloat(stats.total_principal) * 100) : 0;
    
    res.json({
      ...stats,
      total_paid: parseFloat(totalPaid.rows[0].total_paid),
      roi: Math.round(roi * 100) / 100
    });
  } catch (error) {
    console.error('获取贷款统计错误:', error);
    res.status(500).json({ message: '获取统计信息失败' });
  }
});

module.exports = router;
