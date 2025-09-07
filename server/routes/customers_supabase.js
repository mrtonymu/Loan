const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth_supabase');

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 简化的客户列表获取
router.get('/', auth, async (req, res) => {
  try {
    console.log('🔍 开始获取客户列表...');
    
    // 简单的客户查询
    const { data: customers, error } = await supabase
      .from('customers')
      .select('*')
      .limit(10);
    
    if (error) {
      console.error('❌ Supabase 查询错误:', error);
      return res.status(500).json({ 
        message: '获取客户列表失败', 
        error: error.message 
      });
    }
    
    console.log('✅ 成功获取客户数据:', customers?.length || 0, '条记录');
    
    res.json({
      customers: customers || [],
      pagination: {
        page: 1,
        limit: 10,
        total: customers?.length || 0,
        pages: 1
      }
    });
  } catch (error) {
    console.error('❌ 获取客户列表错误:', error);
    res.status(500).json({ 
      message: '获取客户列表失败', 
      error: error.message 
    });
  }
});

// 简化的客户创建
router.post('/', auth, async (req, res) => {
  try {
    console.log('➕ 开始创建客户...', req.body);
    
    // 生成客户编号
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    
    // 获取当天客户数量
    const { count } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${year}-${month}-${day}T00:00:00.000Z`)
      .lt('created_at', `${year}-${month}-${day}T23:59:59.999Z`);
    
    const customerNumber = `CN${year}${month}${day}${String((count || 0) + 1).padStart(3, '0')}`;
    
    // 只保存现有字段，过滤掉不存在的字段
    const allowedFields = [
      'customer_code', 'full_name', 'id_number', 'phone', 'address',
      'emergency_contact', 'emergency_phone', 'rm_amount', 'status',
      'risk_level', 'is_blacklisted', 'notes'
    ];
    
    const customerData = {
      customer_code: req.body.customer_code || `C${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      customer_number: customerNumber,
      assigned_to: req.user.id,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // 只添加存在的字段
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        customerData[field] = req.body[field];
      }
    });
    
    const { data: customer, error } = await supabase
      .from('customers')
      .insert([customerData])
      .select()
      .single();
    
    if (error) {
      console.error('❌ Supabase 插入错误:', error);
      return res.status(500).json({ 
        message: '创建客户失败', 
        error: error.message 
      });
    }
    
    console.log('✅ 成功创建客户:', customer.id);
    
    res.status(201).json({
      message: '客户创建成功',
      customer
    });
  } catch (error) {
    console.error('❌ 创建客户错误:', error);
    res.status(500).json({ 
      message: '创建客户失败', 
      error: error.message 
    });
  }
});

// 获取客户状态统计
router.get('/stats/status', auth, async (req, res) => {
  try {
    // 权限控制
    let customerQuery = supabase.from('customers').select('status');
    if (req.user.role === 'employee') {
      customerQuery = customerQuery.eq('assigned_to', req.user.id);
    }
    
    const { data: customers, error: customerError } = await customerQuery;
    
    if (customerError) {
      console.error('获取客户状态统计错误:', customerError);
      return res.status(500).json({ message: '获取统计信息失败' });
    }
    
    // 计算状态分布
    const stats = {
      normal: 0,
      cleared: 0,
      negotiating: 0,
      bad_debt: 0
    };
    
    if (customers) {
      customers.forEach(customer => {
        const status = customer.status || 'normal';
        if (stats.hasOwnProperty(status)) {
          stats[status]++;
        }
      });
    }
    
    res.json(stats);
  } catch (error) {
    console.error('获取客户状态统计错误:', error);
    res.status(500).json({ message: '获取统计信息失败' });
  }
});

// 更新客户状态
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // 验证状态值
    const validStatuses = ['normal', 'cleared', 'negotiating', 'bad_debt'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: '无效的状态值' });
    }
    
    // 检查客户是否存在
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (customerError || !customer) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customer.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限修改此客户状态' });
    }
    
    // 更新客户状态
    const { data: updatedCustomer, error: updateError } = await supabase
      .from('customers')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      console.error('更新客户状态错误:', updateError);
      return res.status(500).json({ message: '更新客户状态失败' });
    }
    
    res.json({
      message: '客户状态更新成功',
      customer: updatedCustomer
    });
  } catch (error) {
    console.error('更新客户状态错误:', error);
    res.status(500).json({ message: '更新客户状态失败' });
  }
});

// 获取单个客户详情
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !customer) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && customer.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限查看此客户' });
    }
    
    // 获取客户的贷款信息
    const { data: loans, error: loanError } = await supabase
      .from('loans')
      .select('*')
      .eq('customer_id', id);
    
    if (loanError) {
      console.error('获取客户贷款信息错误:', loanError);
    }
    
    // 获取客户的还款信息
    const loanIds = loans?.map(loan => loan.id) || [];
    let repayments = [];
    
    if (loanIds.length > 0) {
      const { data: repaymentData, error: repaymentError } = await supabase
        .from('repayments')
        .select('*')
        .in('loan_id', loanIds);
      
      if (!repaymentError) {
        repayments = repaymentData || [];
      }
    }
    
    res.json({
      customer: customer,
      loans: loans || [],
      repayments: repayments
    });
  } catch (error) {
    console.error('获取客户详情错误:', error);
    res.status(500).json({ message: '获取客户详情失败' });
  }
});

// 更新客户信息
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // 检查客户是否存在
    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (customerError || !existingCustomer) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && existingCustomer.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限修改此客户' });
    }
    
    // 过滤允许更新的字段
    const allowedFields = [
      'full_name', 'id_number', 'phone', 'address', 'emergency_contact', 
      'emergency_phone', 'notes', 'status', 'risk_level', 'is_blacklisted',
      'blacklist_reason', 'blacklist_date'
    ];
    
    const filteredData = {};
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    });
    
    // 添加更新时间
    filteredData.updated_at = new Date().toISOString();
    
    const { data: updatedCustomer, error: updateError } = await supabase
      .from('customers')
      .update(filteredData)
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      console.error('更新客户信息错误:', updateError);
      return res.status(500).json({ message: '更新客户信息失败' });
    }
    
    res.json({
      message: '客户信息更新成功',
      customer: updatedCustomer
    });
  } catch (error) {
    console.error('更新客户信息错误:', error);
    res.status(500).json({ message: '更新客户信息失败' });
  }
});

// 删除客户
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查客户是否存在
    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (customerError || !existingCustomer) {
      return res.status(404).json({ message: '客户不存在' });
    }
    
    // 权限检查
    if (req.user.role === 'employee' && existingCustomer.assigned_to !== req.user.id) {
      return res.status(403).json({ message: '无权限删除此客户' });
    }
    
    // 检查是否有未结清的贷款
    const { data: activeLoans, error: loanError } = await supabase
      .from('loans')
      .select('id')
      .eq('customer_id', id)
      .eq('status', 'active');
    
    if (loanError) {
      console.error('检查活跃贷款错误:', loanError);
      return res.status(500).json({ message: '删除客户失败' });
    }
    
    if (activeLoans && activeLoans.length > 0) {
      return res.status(400).json({ message: '客户有未结清的贷款，无法删除' });
    }
    
    // 删除客户
    const { error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      console.error('删除客户错误:', deleteError);
      return res.status(500).json({ message: '删除客户失败' });
    }
    
    res.json({ message: '客户删除成功' });
  } catch (error) {
    console.error('删除客户错误:', error);
    res.status(500).json({ message: '删除客户失败' });
  }
});

module.exports = router;
