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

module.exports = router;
