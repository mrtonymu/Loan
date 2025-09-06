const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { auth } = require('../middleware/auth');

// 获取所有风险标签
router.get('/', auth, async (req, res) => {
  try {
    const query = `
      SELECT * FROM risk_tags 
      WHERE is_active = true 
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching risk tags:', error);
    res.status(500).json({ success: false, message: '获取风险标签失败' });
  }
});

// 创建风险标签
router.post('/', auth, async (req, res) => {
  try {
    const { tag_name, tag_color, description } = req.body;

    if (!tag_name) {
      return res.status(400).json({ success: false, message: '标签名称不能为空' });
    }

    const query = `
      INSERT INTO risk_tags (tag_name, tag_color, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await pool.query(query, [tag_name, tag_color, description]);

    res.json({
      success: true,
      message: '风险标签创建成功',
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: '标签名称已存在' });
    }
    console.error('Error creating risk tag:', error);
    res.status(500).json({ success: false, message: '创建风险标签失败' });
  }
});

// 更新风险标签
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { tag_name, tag_color, description, is_active } = req.body;

    const query = `
      UPDATE risk_tags 
      SET tag_name = $1, tag_color = $2, description = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `;

    const result = await pool.query(query, [tag_name, tag_color, description, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '风险标签不存在' });
    }

    res.json({
      success: true,
      message: '风险标签更新成功',
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: '标签名称已存在' });
    }
    console.error('Error updating risk tag:', error);
    res.status(500).json({ success: false, message: '更新风险标签失败' });
  }
});

// 删除风险标签
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查是否有客户使用此标签
    const checkQuery = 'SELECT COUNT(*) as count FROM customer_risk_tags WHERE tag_id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        success: false, 
        message: '此标签正在被客户使用，无法删除' 
      });
    }

    const query = 'DELETE FROM risk_tags WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: '风险标签不存在' });
    }

    res.json({
      success: true,
      message: '风险标签删除成功'
    });
  } catch (error) {
    console.error('Error deleting risk tag:', error);
    res.status(500).json({ success: false, message: '删除风险标签失败' });
  }
});

// 为客户添加风险标签
router.post('/customer/:customerId', auth, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tag_id } = req.body;

    if (!tag_id) {
      return res.status(400).json({ success: false, message: '请选择要添加的标签' });
    }

    const query = `
      INSERT INTO customer_risk_tags (customer_id, tag_id, added_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (customer_id, tag_id) DO NOTHING
      RETURNING *
    `;

    const result = await pool.query(query, [customerId, tag_id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: '客户已拥有此标签' });
    }

    res.json({
      success: true,
      message: '风险标签添加成功',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding risk tag to customer:', error);
    res.status(500).json({ success: false, message: '添加风险标签失败' });
  }
});

// 移除客户的风险标签
router.delete('/customer/:customerId/:tagId', auth, async (req, res) => {
  try {
    const { customerId, tagId } = req.params;

    const query = 'DELETE FROM customer_risk_tags WHERE customer_id = $1 AND tag_id = $2';
    const result = await pool.query(query, [customerId, tagId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: '客户没有此标签' });
    }

    res.json({
      success: true,
      message: '风险标签移除成功'
    });
  } catch (error) {
    console.error('Error removing risk tag from customer:', error);
    res.status(500).json({ success: false, message: '移除风险标签失败' });
  }
});

// 获取客户的风险标签
router.get('/customer/:customerId', auth, async (req, res) => {
  try {
    const { customerId } = req.params;

    const query = `
      SELECT 
        rt.*,
        crt.added_at,
        u.username as added_by_name
      FROM customer_risk_tags crt
      JOIN risk_tags rt ON crt.tag_id = rt.id
      LEFT JOIN users u ON crt.added_by = u.id
      WHERE crt.customer_id = $1
      ORDER BY crt.added_at DESC
    `;

    const result = await pool.query(query, [customerId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching customer risk tags:', error);
    res.status(500).json({ success: false, message: '获取客户风险标签失败' });
  }
});

// 获取带风险标签的客户列表
router.get('/customers', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, tag_id } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let queryParams = [];
    let paramCount = 0;

    if (tag_id) {
      paramCount++;
      whereClause = `WHERE crt.tag_id = $${paramCount}`;
      queryParams.push(tag_id);
    }

    const query = `
      SELECT DISTINCT
        c.*,
        COUNT(crt.tag_id) as tag_count,
        STRING_AGG(rt.tag_name, ', ') as tag_names
      FROM customers c
      LEFT JOIN customer_risk_tags crt ON c.id = crt.customer_id
      LEFT JOIN risk_tags rt ON crt.tag_id = rt.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(parseInt(limit), offset);

    const result = await pool.query(query, queryParams);

    // 获取总数
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM customers c
      LEFT JOIN customer_risk_tags crt ON c.id = crt.customer_id
      ${whereClause}
    `;
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
    console.error('Error fetching customers with risk tags:', error);
    res.status(500).json({ success: false, message: '获取客户列表失败' });
  }
});

module.exports = router;
