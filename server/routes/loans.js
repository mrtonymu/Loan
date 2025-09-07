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
  
  const { count, error } = await supabase
    .from('loans')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-${month}-01T00:00:00.000Z`)
    .lt('created_at', `${year}-${month}-31T23:59:59.999Z`);
  
  if (error) {
    console.error('获取贷款数量错误:', error);
    return `L${year}${month}0001`;
  }
  
  const loanCount = (count || 0) + 1;
  return `L${year}${month}${String(loanCount).padStart(4, '0')}`;
};

// 使用新的贷款计算逻辑

// 使用新的还款计划生成逻辑

// 获取所有贷款
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, customer_id, search } = req.query;
    const offset = (page - 1) * limit;
    
    // 构建查询
    let loanQuery = supabase
      .from('loans')
      .select(`
        *,
        customers!inner(full_name, customer_code, phone, assigned_to),
        users!created_by(full_name)
      `);
    
    // 权限控制
    if (req.user.role === 'employee') {
      loanQuery = loanQuery.eq('customers.assigned_to', req.user.id);
    }
    
    // 状态筛选
    if (status) {
      loanQuery = loanQuery.eq('status', status);
    }
    
    // 客户筛选
    if (customer_id) {
      loanQuery = loanQuery.eq('customer_id', customer_id);
    }
    
    // 搜索功能
    if (search) {
      loanQuery = loanQuery.or(`loan_number.ilike.%${search}%,customers.full_name.ilike.%${search}%,customers.customer_code.ilike.%${search}%`);
    }
    
    // 分页和排序
    loanQuery = loanQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    const { data: loans, error: loanError, count: totalCount } = await loanQuery;
    
    if (loanError) {
      console.error('获取贷款列表错误:', loanError);
      return res.status(500).json({ message: '获取贷款列表失败' });
    }
    
    // 获取还款统计
    const loanIds = loans?.map(loan => loan.id) || [];
    let repaymentStats = {};
    
    if (loanIds.length > 0) {
      const { data: repayments, error: repaymentError } = await supabase
        .from('repayments')
        .select('loan_id, status, paid_amount')
        .in('loan_id', loanIds);
      
      if (!repaymentError && repayments) {
        repayments.forEach(repayment => {
          const loanId = repayment.loan_id;
          if (!repaymentStats[loanId]) {
            repaymentStats[loanId] = {
              total_repayments: 0,
              total_paid: 0,
              overdue_count: 0
            };
          }
          
          repaymentStats[loanId].total_repayments++;
          if (repayment.status === 'paid') {
            repaymentStats[loanId].total_paid += repayment.paid_amount || 0;
          }
          if (repayment.status === 'overdue') {
            repaymentStats[loanId].overdue_count++;
          }
        });
      }
    }
    
    // 合并数据
    const loansWithStats = loans?.map(loan => ({
      ...loan,
      customer_name: loan.customers?.full_name,
      customer_code: loan.customers?.customer_code,
      customer_phone: loan.customers?.phone,
      created_by_name: loan.users?.full_name,
      ...repaymentStats[loan.id]
    })) || [];
    
    res.json({
      loans: loansWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount || 0,
        pages: Math.ceil((totalCount || 0) / parseInt(limit))
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
    
    const { data: loans, error: loanError } = await supabase
      .from('loans')
      .select(`
        *,
        customers!inner(full_name, customer_code, phone, id_number, address, assigned_to),
        users!created_by(full_name)
      `)
      .eq('id', id)
      .single();
    
    if (loanError) {
      console.error('获取贷款详情错误:', loanError);
      return res.status(404).json({ message: '贷款不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee') {
      if (loans.customers.assigned_to !== req.user.id) {
        return res.status(403).json({ message: '无权限访问此贷款' });
      }
    }
    
    // 获取还款记录
    const { data: repayments, error: repaymentError } = await supabase
      .from('repayments')
      .select('*')
      .eq('loan_id', id)
      .order('repayment_number', { ascending: true });
    
    if (repaymentError) {
      console.error('获取还款记录错误:', repaymentError);
      return res.status(500).json({ message: '获取还款记录失败' });
    }
    
    // 格式化数据
    const loan = {
      ...loans,
      customer_name: loans.customers?.full_name,
      customer_code: loans.customers?.customer_code,
      customer_phone: loans.customers?.phone,
      id_number: loans.customers?.id_number,
      address: loans.customers?.address,
      created_by_name: loans.users?.full_name
    };
    
    res.json({
      loan,
      repayments: repayments || []
    });
  } catch (error) {
    console.error('获取贷款详情错误:', error);
    res.status(500).json({ message: '获取贷款详情失败' });
  }
});

// 创建新贷款
router.post('/', auth, validateLoan, async (req, res) => {
  try {
    const {
      customer_id, principal_amount, interest_rate, loan_term_months,
      collateral_description, collateral_value, loan_purpose,
      loan_method = 'method1', deposit_amount = 0, upfront_fees = 0
    } = req.body;
    
    // 验证客户是否存在
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customer_id)
      .single();
    
    if (customerError || !customers) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customers.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限为此客户创建贷款' });
    }
    
    // 检查客户是否有未结清的贷款
    const { count: activeLoanCount, error: activeLoanError } = await supabase
      .from('loans')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', customer_id)
      .eq('status', 'active');
    
    if (activeLoanError) {
      console.error('检查活跃贷款错误:', activeLoanError);
      return res.status(500).json({ message: '创建贷款失败' });
    }
    
    if (activeLoanCount > 0) {
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
    const { data: loan, error: loanError } = await supabase
      .from('loans')
      .insert([{
        loan_number: loanNumber,
        customer_id: customer_id,
        principal_amount: principal_amount,
        interest_rate: interest_rate,
        loan_term_months: loan_term_months,
        monthly_payment: loanData.monthlyPayment,
        total_amount: loanData.totalAmount,
        received_amount: loanData.receivedAmount,
        collateral_description: collateral_description,
        collateral_value: collateral_value,
        loan_purpose: loan_purpose,
        disbursement_date: disbursementDate.toISOString().split('T')[0],
        maturity_date: maturityDate.toISOString().split('T')[0],
        created_by: req.user.id,
        loan_method: loan_method,
        deposit_amount: deposit_amount,
        upfront_interest: loanData.upfrontInterest,
        upfront_fees: upfront_fees,
        prepaid_amount: 0,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (loanError) {
      console.error('创建贷款错误:', loanError);
      return res.status(500).json({ message: '创建贷款失败' });
    }
    
    const loanId = loan.id;
    
    // 生成还款计划
    const repayments = generateRepaymentSchedule({
      ...loanData,
      targetAmount: loanData.targetAmount
    });
    
    // 批量插入还款计划
    if (repayments.length > 0) {
      const repaymentData = repayments.map(repayment => ({
        loan_id: loanId,
        repayment_number: repayment.repayment_number,
        due_date: repayment.due_date,
        principal_amount: repayment.principal_amount,
        interest_amount: repayment.interest_amount,
        total_amount: repayment.total_amount,
        remaining_balance: repayment.remaining_balance,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      
      const { error: repaymentError } = await supabase
        .from('repayments')
        .insert(repaymentData);
      
      if (repaymentError) {
        console.error('创建还款计划错误:', repaymentError);
        // 删除已创建的贷款
        await supabase.from('loans').delete().eq('id', loanId);
        return res.status(500).json({ message: '创建还款计划失败' });
      }
    }
    
    // 更新客户的RM金额
    const newRMAmount = (customers.rm_amount || 0) + loanData.totalAmount;
    const { error: updateError } = await supabase
      .from('customers')
      .update({ 
        rm_amount: newRMAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', customer_id);
    
    if (updateError) {
      console.error('更新客户RM金额错误:', updateError);
      // 删除已创建的贷款和还款计划
      await supabase.from('repayments').delete().eq('loan_id', loanId);
      await supabase.from('loans').delete().eq('id', loanId);
      return res.status(500).json({ message: '更新客户信息失败' });
    }
    
    res.status(201).json({
      message: '贷款创建成功',
      loan: loan,
      loanData: {
        receivedAmount: loanData.receivedAmount,
        targetAmount: loanData.targetAmount,
        depositAmount: loanData.depositAmount,
        upfrontInterest: loanData.upfrontInterest
      }
    });
  } catch (error) {
    console.error('创建贷款错误:', error);
    res.status(500).json({ message: '创建贷款失败' });
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
    const { data: loan, error: loanError } = await supabase
      .from('loans')
      .select('*, customers!inner(assigned_to)')
      .eq('id', id)
      .single();
    
    if (loanError || !loan) {
      return res.status(404).json({ message: '贷款不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee') {
      if (loan.customers.assigned_to !== req.user.id) {
        return res.status(403).json({ message: '无权限修改此贷款' });
      }
    }
    
    // 需要审批的操作
    if (['completed', 'defaulted', 'cancelled'].includes(status) && req.user.role === 'employee') {
      const { error: approvalError } = await supabase
        .from('approvals')
        .insert([{
          entity_type: 'loan',
          entity_id: id,
          action: 'update',
          requested_by: req.user.id,
          comments: `贷款状态修改为${status}需要审批`,
          created_at: new Date().toISOString()
        }]);
      
      if (approvalError) {
        console.error('创建审批请求错误:', approvalError);
        return res.status(500).json({ message: '提交审批请求失败' });
      }
      
      return res.status(202).json({ message: '状态修改请求已提交，等待审批' });
    }
    
    const { data: updatedLoan, error: updateError } = await supabase
      .from('loans')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      console.error('更新贷款状态错误:', updateError);
      return res.status(500).json({ message: '更新贷款状态失败' });
    }
    
    res.json({
      message: '贷款状态更新成功',
      loan: updatedLoan
    });
  } catch (error) {
    console.error('更新贷款状态错误:', error);
    res.status(500).json({ message: '更新贷款状态失败' });
  }
});

// 获取贷款统计
router.get('/stats/overview', auth, async (req, res) => {
  try {
    // 构建贷款查询
    let loanQuery = supabase
      .from('loans')
      .select(`
        *,
        customers!inner(assigned_to)
      `);
    
    // 权限控制
    if (req.user.role === 'employee') {
      loanQuery = loanQuery.eq('customers.assigned_to', req.user.id);
    }
    
    const { data: loans, error: loanError } = await loanQuery;
    
    if (loanError) {
      console.error('获取贷款统计错误:', loanError);
      return res.status(500).json({ message: '获取统计信息失败' });
    }
    
    // 计算统计数据
    const stats = {
      total_loans: loans?.length || 0,
      total_principal: loans?.reduce((sum, loan) => sum + (loan.principal_amount || 0), 0) || 0,
      total_amount: loans?.reduce((sum, loan) => sum + (loan.total_amount || 0), 0) || 0,
      total_received: loans?.reduce((sum, loan) => sum + (loan.received_amount || 0), 0) || 0,
      active_loans: loans?.filter(loan => loan.status === 'active').length || 0,
      completed_loans: loans?.filter(loan => loan.status === 'completed').length || 0,
      defaulted_loans: loans?.filter(loan => loan.status === 'defaulted').length || 0
    };
    
    // 获取还款统计
    const loanIds = loans?.map(loan => loan.id) || [];
    let totalPaid = 0;
    
    if (loanIds.length > 0) {
      const { data: repayments, error: repaymentError } = await supabase
        .from('repayments')
        .select('paid_amount')
        .eq('status', 'paid')
        .in('loan_id', loanIds);
      
      if (!repaymentError && repayments) {
        totalPaid = repayments.reduce((sum, repayment) => sum + (repayment.paid_amount || 0), 0);
      }
    }
    
    // 计算ROI
    const roi = stats.total_principal > 0 ? 
      ((totalPaid - stats.total_principal) / stats.total_principal * 100) : 0;
    
    res.json({
      ...stats,
      total_paid: totalPaid,
      roi: Math.round(roi * 100) / 100
    });
  } catch (error) {
    console.error('获取贷款统计错误:', error);
    res.status(500).json({ message: '获取统计信息失败' });
  }
});

module.exports = router;
