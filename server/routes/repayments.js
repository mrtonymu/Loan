const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { auth } = require('../middleware/auth_supabase');
const { validateRepayment } = require('../middleware/validation');
const { allocatePayment, checkSettlementCondition, calculateOverdueDays, updateCustomerStatus } = require('../utils/loanCalculator');

// 获取还款记录
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, loan_id, status, overdue_only } = req.query;
    const offset = (page - 1) * limit;
    
    // 构建查询
    let repaymentQuery = supabase
      .from('repayments')
      .select(`
        *,
        loans!inner(loan_number, customer_id, customers!inner(full_name, customer_code, assigned_to))
      `);
    
    // 权限控制
    if (req.user.role === 'employee') {
      repaymentQuery = repaymentQuery.eq('loans.customers.assigned_to', req.user.id);
    }
    
    // 贷款筛选
    if (loan_id) {
      repaymentQuery = repaymentQuery.eq('loan_id', loan_id);
    }
    
    // 状态筛选
    if (status) {
      if (status === 'overdue') {
        const today = new Date().toISOString().split('T')[0];
        repaymentQuery = repaymentQuery
          .lt('due_date', today)
          .eq('status', 'pending');
      } else {
        repaymentQuery = repaymentQuery.eq('status', status);
      }
    }
    
    // 只显示逾期
    if (overdue_only === 'true') {
      const today = new Date().toISOString().split('T')[0];
      repaymentQuery = repaymentQuery
        .lt('due_date', today)
        .eq('status', 'pending');
    }
    
    // 分页和排序
    repaymentQuery = repaymentQuery
      .order('due_date', { ascending: true })
      .order('repayment_number', { ascending: true })
      .range(offset, offset + limit - 1);
    
    const { data: repayments, error: repaymentError, count: totalCount } = await repaymentQuery;
    
    if (repaymentError) {
      console.error('获取还款记录错误:', repaymentError);
      return res.status(500).json({ message: '获取还款记录失败' });
    }
    
    // 计算实际状态（逾期检查）
    const repaymentsWithStatus = repayments?.map(repayment => {
      const dueDate = new Date(repayment.due_date);
      const today = new Date();
      const actualStatus = dueDate < today && repayment.status === 'pending' ? 'overdue' : repayment.status;
      
      return {
        ...repayment,
        actual_status: actualStatus,
        customer_name: repayment.loans?.customers?.full_name,
        customer_code: repayment.loans?.customers?.customer_code,
        loan_number: repayment.loans?.loan_number
      };
    }) || [];
    
    res.json({
      repayments: repaymentsWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount || 0,
        pages: Math.ceil((totalCount || 0) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('获取还款记录错误:', error);
    res.status(500).json({ message: '获取还款记录失败' });
  }
});

// 处理还款
router.post('/:id/pay', auth, validateRepayment, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { paid_amount, payment_method, notes } = req.body;
    
    // 获取还款记录和贷款信息
    const repaymentResult = await client.query(`
      SELECT r.*, l.customer_id, c.assigned_to, l.loan_method, l.prepaid_amount,
             l.deposit_amount, l.upfront_interest, l.upfront_fees
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE r.id = $1
    `, [id]);
    
    if (repaymentResult.rows.length === 0) {
      return res.status(404).json({ message: '还款记录不存在' });
    }
    
    const repayment = repaymentResult.rows[0];
    
    // 权限检查
    if (req.user.role === 'employee' && repayment.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限处理此还款' });
    }
    
    // 检查还款状态
    if (repayment.status === 'paid') {
      return res.status(400).json({ message: '此期还款已完成' });
    }
    
    // 获取未付金额
    const outstandingFees = repayment.upfront_fees || 0;
    const outstandingInterest = repayment.interest_amount - (repayment.paid_amount || 0);
    const outstandingPrincipal = repayment.principal_amount - (repayment.paid_amount || 0);
    
    // 使用新的分配逻辑
    const allocation = allocatePayment({
      paidAmount: parseFloat(paid_amount),
      outstandingFees: Math.max(0, outstandingFees),
      outstandingInterest: Math.max(0, outstandingInterest),
      outstandingPrincipal: Math.max(0, outstandingPrincipal),
      prepaidAmount: repayment.prepaid_amount || 0
    });
    
    // 计算新的还款状态
    const newPaidAmount = parseFloat(repayment.paid_amount || 0) + parseFloat(paid_amount);
    const remainingAmount = parseFloat(repayment.total_amount) - newPaidAmount;
    
    let newStatus;
    if (remainingAmount <= 0) {
      newStatus = 'paid';
    } else if (newPaidAmount > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'pending';
    }
    
    // 更新还款记录
    const updateResult = await client.query(`
      UPDATE repayments SET
        paid_amount = $1,
        status = $2,
        payment_date = $3,
        payment_method = $4,
        notes = COALESCE($5, notes),
        fee_amount = $6,
        prepaid_offset = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `, [
      newPaidAmount, newStatus, new Date().toISOString().split('T')[0],
      payment_method, notes, allocation.feeAmount, allocation.prepaidOffset, id
    ]);
    
    // 更新贷款的预收金额
    if (allocation.prepaidOffset > 0) {
      await client.query(
        'UPDATE loans SET prepaid_amount = $1 WHERE id = $2',
        [allocation.newPrepaidAmount, repayment.loan_id]
      );
    }
    
    // 检查结清条件
    if (newStatus === 'paid') {
      // 检查是否所有还款都已完成
      const allRepaymentsResult = await client.query(
        'SELECT COUNT(*) FROM repayments WHERE loan_id = $1 AND status != $2',
        [repayment.loan_id, 'paid']
      );
      
      if (parseInt(allRepaymentsResult.rows[0].count) === 0) {
        // 检查结清条件
        const isSettled = checkSettlementCondition({
          outstandingInterest: 0,
          outstandingPrincipal: 0
        });
        
        if (isSettled) {
          // 更新贷款状态为已完成
          await client.query(
            'UPDATE loans SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['completed', repayment.loan_id]
          );
          
          // 更新客户状态为清完
          await client.query(
            'UPDATE customers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['cleared', repayment.customer_id]
          );
        }
      }
    }
    
    await client.query('COMMIT');
    
    res.json({
      message: '还款处理成功',
      repayment: updateResult.rows[0],
      allocation: {
        feeAmount: allocation.feeAmount,
        interestAmount: allocation.interestAmount,
        principalAmount: allocation.principalAmount,
        prepaidOffset: allocation.prepaidOffset,
        newPrepaidAmount: allocation.newPrepaidAmount
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('处理还款错误:', error);
    res.status(500).json({ message: '处理还款失败' });
  } finally {
    client.release();
  }
});

// 部分还款
router.post('/:id/partial', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { principal_amount, interest_amount, payment_method, notes } = req.body;
    
    // 获取还款记录
    const repaymentResult = await client.query(`
      SELECT r.*, l.customer_id, c.assigned_to
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE r.id = $1
    `, [id]);
    
    if (repaymentResult.rows.length === 0) {
      return res.status(404).json({ message: '还款记录不存在' });
    }
    
    const repayment = repaymentResult.rows[0];
    
    // 权限检查
    if (req.user.role === 'employee' && repayment.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限处理此还款' });
    }
    
    // 检查还款状态
    if (repayment.status === 'paid') {
      return res.status(400).json({ message: '此期还款已完成' });
    }
    
    const paidAmount = parseFloat(principal_amount) + parseFloat(interest_amount);
    const newPaidAmount = parseFloat(repayment.paid_amount) + paidAmount;
    const remainingAmount = parseFloat(repayment.total_amount) - newPaidAmount;
    
    let newStatus;
    if (remainingAmount <= 0) {
      newStatus = 'paid';
    } else {
      newStatus = 'partial';
    }
    
    // 更新还款记录
    const updateResult = await client.query(`
      UPDATE repayments SET
        paid_amount = $1,
        status = $2,
        payment_date = $3,
        payment_method = $4,
        notes = COALESCE($5, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `, [
      newPaidAmount, newStatus, new Date().toISOString().split('T')[0],
      payment_method, notes, id
    ]);
    
    // 如果完全还清，检查是否需要更新贷款状态
    if (newStatus === 'paid') {
      const allRepaymentsResult = await client.query(
        'SELECT COUNT(*) FROM repayments WHERE loan_id = $1 AND status != $2',
        [repayment.loan_id, 'paid']
      );
      
      if (parseInt(allRepaymentsResult.rows[0].count) === 0) {
        await client.query(
          'UPDATE loans SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['completed', repayment.loan_id]
        );
        
        await client.query(
          'UPDATE customers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['cleared', repayment.customer_id]
        );
      }
    }
    
    await client.query('COMMIT');
    
    res.json({
      message: '部分还款处理成功',
      repayment: updateResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('处理部分还款错误:', error);
    res.status(500).json({ message: '处理部分还款失败' });
  } finally {
    client.release();
  }
});

// 结清贷款
router.post('/:id/settle', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { settlement_amount, payment_method, notes } = req.body;
    
    // 获取还款记录
    const repaymentResult = await client.query(`
      SELECT r.*, l.customer_id, c.assigned_to, l.id as loan_id
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE r.id = $1
    `, [id]);
    
    if (repaymentResult.rows.length === 0) {
      return res.status(404).json({ message: '还款记录不存在' });
    }
    
    const repayment = repaymentResult.rows[0];
    
    // 权限检查
    if (req.user.role === 'employee' && repayment.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限处理此还款' });
    }
    
    // 需要审批
    if (req.user.role === 'employee') {
      await client.query(`
        INSERT INTO approvals (entity_type, entity_id, action, requested_by, comments)
        VALUES ('repayment', $1, 'update', $2, $3)
      `, [id, req.user.id, '贷款结清需要审批']);
      
      await client.query('COMMIT');
      return res.status(202).json({ message: '结清请求已提交，等待审批' });
    }
    
    // 更新当前还款记录
    await client.query(`
      UPDATE repayments SET
        paid_amount = $1,
        status = $2,
        payment_date = $3,
        payment_method = $4,
        notes = COALESCE($5, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `, [
      settlement_amount, 'paid', new Date().toISOString().split('T')[0],
      payment_method, notes, id
    ]);
    
    // 将所有未完成的还款标记为已结清
    await client.query(`
      UPDATE repayments SET
        status = $1,
        payment_date = $2,
        payment_method = $3,
        notes = COALESCE($4, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE loan_id = $5 AND status != $1
    `, [
      'paid', new Date().toISOString().split('T')[0],
      payment_method, '提前结清', repayment.loan_id
    ]);
    
    // 更新贷款状态
    await client.query(
      'UPDATE loans SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['completed', repayment.loan_id]
    );
    
    // 更新客户状态
    await client.query(
      'UPDATE customers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['cleared', repayment.customer_id]
    );
    
    await client.query('COMMIT');
    
    res.json({
      message: '贷款结清成功'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('结清贷款错误:', error);
    res.status(500).json({ message: '结清贷款失败' });
  } finally {
    client.release();
  }
});

// 获取逾期统计
router.get('/stats/overdue', auth, async (req, res) => {
  try {
    let query = `
      SELECT 
        COUNT(*) as overdue_count,
        COALESCE(SUM(total_amount - paid_amount), 0) as overdue_amount
      FROM repayments r
      LEFT JOIN loans l ON r.loan_id = l.id
      LEFT JOIN customers c ON l.customer_id = c.id
      WHERE r.due_date < CURRENT_DATE AND r.status = 'pending'
    `;
    
    const params = [];
    let paramCount = 0;
    
    // 权限控制
    if (req.user.role === 'employee') {
      paramCount++;
      query += ` AND c.assigned_to = $${paramCount}`;
      params.push(req.user.id);
    }
    
    const result = await pool.query(query, params);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('获取逾期统计错误:', error);
    res.status(500).json({ message: '获取逾期统计失败' });
  }
});

module.exports = router;
