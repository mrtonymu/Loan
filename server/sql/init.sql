-- 初始化数据库和默认数据

-- 创建数据库（如果不存在）
-- CREATE DATABASE loan_management;

-- 使用数据库
-- \c loan_management;

-- 创建默认管理员用户
INSERT INTO users (username, email, password_hash, role, full_name, phone, is_active) 
VALUES (
  'admin', 
  'admin@example.com', 
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: admin123
  'admin', 
  '系统管理员', 
  '13800138000',
  true
) ON CONFLICT (username) DO NOTHING;

-- 创建测试员工用户
INSERT INTO users (username, email, password_hash, role, full_name, phone, is_active) 
VALUES 
  (
    'employee1', 
    'employee1@example.com', 
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: admin123
    'employee', 
    '张三', 
    '13800138001',
    true
  ),
  (
    'secretary1', 
    'secretary1@example.com', 
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: admin123
    'secretary', 
    '李四', 
    '13800138002',
    true
  ),
  (
    'manager1', 
    'manager1@example.com', 
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: admin123
    'manager', 
    '王五', 
    '13800138003',
    true
  )
ON CONFLICT (username) DO NOTHING;

-- 创建测试客户数据
INSERT INTO customers (
  customer_code, customer_number, full_name, id_number, phone, address,
  emergency_contact, emergency_phone, rm_amount, status, risk_level, 
  assigned_to, created_by, notes
) VALUES 
  (
    'C202412001', 'CN2024120001', '赵六', '110101199001011234', '13900139001',
    '北京市朝阳区某某街道123号', '赵七', '13900139002', 50000.00, 'normal', 'low',
    2, 1, '优质客户，信用良好'
  ),
  (
    'C202412002', 'CN2024120002', '钱八', '110101199002021234', '13900139003',
    '上海市浦东新区某某路456号', '钱九', '13900139004', 30000.00, 'normal', 'medium',
    2, 1, '一般客户，需要关注'
  ),
  (
    'C202412003', 'CN2024120003', '孙十', '110101199003031234', '13900139005',
    '广州市天河区某某大道789号', '孙十一', '13900139006', 0.00, 'cleared', 'low',
    2, 1, '已结清所有贷款'
  ),
  (
    'C202412004', 'CN2024120004', '周十二', '110101199004041234', '13900139007',
    '深圳市南山区某某路101号', '周十三', '13900139008', 80000.00, 'negotiating', 'high',
    2, 1, '正在协商还款方案'
  ),
  (
    'C202412005', 'CN2024120005', '吴十四', '110101199005051234', '13900139009',
    '杭州市西湖区某某街202号', '吴十五', '13900139010', 0.00, 'bad_debt', 'high',
    2, 1, '已列入黑名单'
  )
ON CONFLICT (customer_code) DO NOTHING;

-- 创建测试贷款数据
INSERT INTO loans (
  loan_number, customer_id, principal_amount, interest_rate, loan_term_months,
  monthly_payment, total_amount, received_amount, collateral_description,
  collateral_value, loan_purpose, status, disbursement_date, maturity_date, created_by
) VALUES 
  (
    'L2024120001', 1, 50000.00, 12.00, 12, 4442.45, 53309.40, 50000.00,
    '房产抵押', 80000.00, '经营周转', 'active', '2024-01-01', '2024-12-31', 1
  ),
  (
    'L2024120002', 2, 30000.00, 15.00, 6, 5258.50, 31551.00, 30000.00,
    '车辆抵押', 50000.00, '消费贷款', 'active', '2024-02-01', '2024-07-31', 1
  ),
  (
    'L2024120003', 4, 80000.00, 18.00, 24, 4000.00, 96000.00, 80000.00,
    '设备抵押', 120000.00, '设备采购', 'active', '2024-03-01', '2026-02-28', 1
  )
ON CONFLICT (loan_number) DO NOTHING;

-- 为第一个贷款创建还款计划
INSERT INTO repayments (
  loan_id, repayment_number, due_date, principal_amount, interest_amount,
  total_amount, remaining_balance
) VALUES 
  (1, 1, '2024-02-01', 3942.45, 500.00, 4442.45, 46057.55),
  (1, 2, '2024-03-01', 3981.87, 460.58, 4442.45, 42075.68),
  (1, 3, '2024-04-01', 4021.66, 420.79, 4442.45, 38054.02),
  (1, 4, '2024-05-01', 4061.82, 380.63, 4442.45, 33992.20),
  (1, 5, '2024-06-01', 4102.36, 340.09, 4442.45, 29889.84),
  (1, 6, '2024-07-01', 4143.28, 299.17, 4442.45, 25746.56),
  (1, 7, '2024-08-01', 4184.59, 257.86, 4442.45, 21561.97),
  (1, 8, '2024-09-01', 4226.29, 216.16, 4442.45, 17335.68),
  (1, 9, '2024-10-01', 4268.38, 174.07, 4442.45, 13067.30),
  (1, 10, '2024-11-01', 4310.87, 131.58, 4442.45, 8756.43),
  (1, 11, '2024-12-01', 4353.76, 88.69, 4442.45, 4402.67),
  (1, 12, '2025-01-01', 4402.67, 39.78, 4442.45, 0.00)
ON CONFLICT DO NOTHING;

-- 为第二个贷款创建还款计划
INSERT INTO repayments (
  loan_id, repayment_number, due_date, principal_amount, interest_amount,
  total_amount, remaining_balance
) VALUES 
  (2, 1, '2024-03-01', 4758.50, 500.00, 5258.50, 25241.50),
  (2, 2, '2024-04-01', 4817.34, 441.16, 5258.50, 20424.16),
  (2, 3, '2024-05-01', 4877.55, 380.95, 5258.50, 15546.61),
  (2, 4, '2024-06-01', 4939.15, 319.35, 5258.50, 10607.46),
  (2, 5, '2024-07-01', 5002.16, 256.34, 5258.50, 5605.30),
  (2, 6, '2024-08-01', 5605.30, 0.00, 5605.30, 0.00)
ON CONFLICT DO NOTHING;

-- 为第三个贷款创建还款计划（部分）
INSERT INTO repayments (
  loan_id, repayment_number, due_date, principal_amount, interest_amount,
  total_amount, remaining_balance
) VALUES 
  (3, 1, '2024-04-01', 3200.00, 1200.00, 4400.00, 76800.00),
  (3, 2, '2024-05-01', 3296.00, 1104.00, 4400.00, 73504.00),
  (3, 3, '2024-06-01', 3395.36, 1004.64, 4400.00, 70108.64),
  (3, 4, '2024-07-01', 3498.22, 901.78, 4400.00, 66610.42),
  (3, 5, '2024-08-01', 3604.67, 795.33, 4400.00, 63005.75),
  (3, 6, '2024-09-01', 3714.81, 685.19, 4400.00, 59290.94),
  (3, 7, '2024-10-01', 3828.75, 571.25, 4400.00, 55462.19),
  (3, 8, '2024-11-01', 3946.61, 453.39, 4400.00, 51515.58),
  (3, 9, '2024-12-01', 4068.51, 331.49, 4400.00, 47447.07),
  (3, 10, '2025-01-01', 4194.57, 205.43, 4400.00, 43252.50)
ON CONFLICT DO NOTHING;

-- 模拟一些还款记录
UPDATE repayments 
SET paid_amount = total_amount, status = 'paid', payment_date = due_date, payment_method = 'bank_transfer'
WHERE loan_id = 1 AND repayment_number <= 3;

UPDATE repayments 
SET paid_amount = total_amount, status = 'paid', payment_date = due_date, payment_method = 'cash'
WHERE loan_id = 2 AND repayment_number <= 2;

-- 更新客户RM金额
UPDATE customers 
SET rm_amount = (
  SELECT COALESCE(SUM(total_amount), 0) 
  FROM loans 
  WHERE customer_id = customers.id AND status = 'active'
);

COMMIT;
