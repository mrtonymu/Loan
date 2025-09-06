const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth_supabase');

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
    let permissionFilter = {};
    if (req.user.role === 'employee') {
      permissionFilter = { created_by: req.user.userId };
    }
    
    // 获取贷款统计
    const { data: loans, error: loansError } = await supabase
      .from('loans')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .match(permissionFilter);
    
    if (loansError) {
      console.error('获取贷款数据错误:', loansError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 获取还款统计
    const { data: repayments, error: repaymentsError } = await supabase
      .from('repayments')
      .select('*')
      .gte('created_at', startDate.toISOString());
    
    if (repaymentsError) {
      console.error('获取还款数据错误:', repaymentsError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 获取客户统计
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .match(permissionFilter);
    
    if (customersError) {
      console.error('获取客户数据错误:', customersError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 计算统计数据
    const totalLoans = loans?.length || 0;
    const totalLoanAmount = loans?.reduce((sum, loan) => sum + (loan.principal_amount || 0), 0) || 0;
    const totalRepayments = repayments?.length || 0;
    const totalRepaymentAmount = repayments?.reduce((sum, repayment) => sum + (repayment.amount || 0), 0) || 0;
    const totalCustomers = customers?.length || 0;
    
    // 计算逾期统计
    const overdueLoans = loans?.filter(loan => {
      const today = new Date();
      const dueDate = new Date(loan.due_date);
      return dueDate < today && loan.status !== 'completed';
    }) || [];
    
    const overdueAmount = overdueLoans.reduce((sum, loan) => sum + (loan.principal_amount || 0), 0);
    
    // 计算状态分布
    const statusDistribution = {
      active: loans?.filter(loan => loan.status === 'active').length || 0,
      completed: loans?.filter(loan => loan.status === 'completed').length || 0,
      overdue: overdueLoans.length,
      defaulted: loans?.filter(loan => loan.status === 'defaulted').length || 0
    };
    
    res.json({
      overview: {
        totalLoans,
        totalLoanAmount,
        totalRepayments,
        totalRepaymentAmount,
        totalCustomers,
        overdueLoans: overdueLoans.length,
        overdueAmount,
        statusDistribution
      },
      period
    });
    
  } catch (error) {
    console.error('Dashboard概览错误:', error);
    res.status(500).json({ message: '获取Dashboard数据失败' });
  }
});

// 获取最近活动
router.get('/recent-activity', auth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // 权限控制
    let permissionFilter = {};
    if (req.user.role === 'employee') {
      permissionFilter = { created_by: req.user.userId };
    }
    
    // 获取最近的贷款
    const { data: recentLoans, error: loansError } = await supabase
      .from('loans')
      .select(`
        *,
        customers (
          customer_code,
          full_name
        )
      `)
      .match(permissionFilter)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));
    
    if (loansError) {
      console.error('获取最近贷款错误:', loansError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 获取最近的还款
    const { data: recentRepayments, error: repaymentsError } = await supabase
      .from('repayments')
      .select(`
        *,
        loans (
          customers (
            customer_code,
            full_name
          )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));
    
    if (repaymentsError) {
      console.error('获取最近还款错误:', repaymentsError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    // 合并并排序活动
    const activities = [];
    
    recentLoans?.forEach(loan => {
      activities.push({
        id: `loan-${loan.id}`,
        type: 'loan',
        title: '新贷款',
        description: `${loan.customers?.full_name || '未知客户'} - RM ${loan.principal_amount}`,
        timestamp: loan.created_at,
        status: loan.status
      });
    });
    
    recentRepayments?.forEach(repayment => {
      activities.push({
        id: `repayment-${repayment.id}`,
        type: 'repayment',
        title: '还款记录',
        description: `${repayment.loans?.customers?.full_name || '未知客户'} - RM ${repayment.amount}`,
        timestamp: repayment.created_at,
        status: repayment.status
      });
    });
    
    // 按时间排序
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      activities: activities.slice(0, parseInt(limit))
    });
    
  } catch (error) {
    console.error('最近活动错误:', error);
    res.status(500).json({ message: '获取最近活动失败' });
  }
});

// 获取逾期统计
router.get('/overdue', auth, async (req, res) => {
  try {
    // 权限控制
    let permissionFilter = {};
    if (req.user.role === 'employee') {
      permissionFilter = { created_by: req.user.userId };
    }
    
    // 获取所有活跃贷款
    const { data: activeLoans, error: loansError } = await supabase
      .from('loans')
      .select(`
        *,
        customers (
          customer_code,
          full_name,
          phone
        )
      `)
      .eq('status', 'active')
      .match(permissionFilter);
    
    if (loansError) {
      console.error('获取活跃贷款错误:', loansError);
      return res.status(500).json({ message: '获取数据失败' });
    }
    
    const today = new Date();
    const overdueLoans = activeLoans?.filter(loan => {
      const dueDate = new Date(loan.due_date);
      return dueDate < today;
    }) || [];
    
    // 按逾期天数分组
    const overdueStats = {
      total: overdueLoans.length,
      byDays: {
        '1-7': 0,
        '8-30': 0,
        '31-90': 0,
        '90+': 0
      },
      totalAmount: 0,
      loans: overdueLoans.map(loan => {
        const dueDate = new Date(loan.due_date);
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        
        let category = '90+';
        if (daysOverdue <= 7) category = '1-7';
        else if (daysOverdue <= 30) category = '8-30';
        else if (daysOverdue <= 90) category = '31-90';
        
        return {
          id: loan.id,
          customer_code: loan.customers?.customer_code,
          customer_name: loan.customers?.full_name,
          phone: loan.customers?.phone,
          principal_amount: loan.principal_amount,
          due_date: loan.due_date,
          days_overdue: daysOverdue,
          category
        };
      })
    };
    
    // 计算各分类数量
    overdueStats.loans.forEach(loan => {
      overdueStats.byDays[loan.category]++;
      overdueStats.totalAmount += loan.principal_amount || 0;
    });
    
    res.json(overdueStats);
    
  } catch (error) {
    console.error('逾期统计错误:', error);
    res.status(500).json({ message: '获取逾期统计失败' });
  }
});

module.exports = router;
