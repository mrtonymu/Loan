-- 逾期与坏账系统数据库结构

-- 添加逾期相关字段到贷款表
ALTER TABLE loans ADD COLUMN IF NOT EXISTS overdue_days INTEGER DEFAULT 0; -- 逾期天数
ALTER TABLE loans ADD COLUMN IF NOT EXISTS last_payment_date DATE; -- 最后还款日期
ALTER TABLE loans ADD COLUMN IF NOT EXISTS overdue_amount DECIMAL(15,2) DEFAULT 0; -- 逾期金额
ALTER TABLE loans ADD COLUMN IF NOT EXISTS overdue_fees DECIMAL(15,2) DEFAULT 0; -- 逾期费用
ALTER TABLE loans ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')); -- 风险等级
ALTER TABLE loans ADD COLUMN IF NOT EXISTS status_reason TEXT; -- 状态变更原因

-- 添加客户逾期状态字段
ALTER TABLE customers ADD COLUMN IF NOT EXISTS overdue_count INTEGER DEFAULT 0; -- 逾期次数
ALTER TABLE customers ADD COLUMN IF NOT EXISTS max_overdue_days INTEGER DEFAULT 0; -- 最大逾期天数
ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklist_status BOOLEAN DEFAULT false; -- 黑名单状态
ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT; -- 黑名单原因
ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklist_date DATE; -- 黑名单日期

-- 创建逾期记录表
CREATE TABLE IF NOT EXISTS overdue_records (
    id SERIAL PRIMARY KEY,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    overdue_days INTEGER NOT NULL,
    overdue_amount DECIMAL(15,2) NOT NULL,
    overdue_fees DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('overdue', 'negotiating', 'bad_debt', 'resolved')),
    action_taken TEXT, -- 采取的行动
    notes TEXT, -- 备注
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建协商记录表
CREATE TABLE IF NOT EXISTS negotiation_records (
    id SERIAL PRIMARY KEY,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    negotiation_type VARCHAR(50) NOT NULL, -- 协商类型：还款计划调整、减免、延期等
    original_amount DECIMAL(15,2) NOT NULL, -- 原始金额
    negotiated_amount DECIMAL(15,2) NOT NULL, -- 协商后金额
    negotiation_terms TEXT NOT NULL, -- 协商条款
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建催收记录表
CREATE TABLE IF NOT EXISTS collection_records (
    id SERIAL PRIMARY KEY,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    collection_type VARCHAR(50) NOT NULL, -- 催收类型：电话、短信、上门、律师函等
    collection_method VARCHAR(50) NOT NULL, -- 催收方式
    contact_person VARCHAR(100), -- 联系人
    contact_info VARCHAR(200), -- 联系信息
    result VARCHAR(50) NOT NULL, -- 催收结果：成功、失败、无响应等
    notes TEXT, -- 催收备注
    next_follow_up_date DATE, -- 下次跟进日期
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建风险标签表
CREATE TABLE IF NOT EXISTS risk_tags (
    id SERIAL PRIMARY KEY,
    tag_name VARCHAR(50) UNIQUE NOT NULL,
    tag_color VARCHAR(20) DEFAULT '#ff4d4f', -- 标签颜色
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建客户风险标签关联表
CREATE TABLE IF NOT EXISTS customer_risk_tags (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES risk_tags(id) ON DELETE CASCADE,
    added_by INTEGER REFERENCES users(id),
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, tag_id)
);

-- 插入默认风险标签
INSERT INTO risk_tags (tag_name, tag_color, description) VALUES
('高风险客户', '#ff4d4f', '多次逾期或违约的客户'),
('VIP客户', '#52c41a', '重要客户，需要特别关注'),
('新客户', '#1890ff', '首次贷款的客户'),
('老客户', '#722ed1', '长期合作的客户'),
('潜在风险', '#faad14', '需要密切监控的客户')
ON CONFLICT (tag_name) DO NOTHING;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_loans_overdue ON loans(overdue_days);
CREATE INDEX IF NOT EXISTS idx_loans_risk_level ON loans(risk_level);
CREATE INDEX IF NOT EXISTS idx_customers_blacklist ON customers(blacklist_status);
CREATE INDEX IF NOT EXISTS idx_overdue_records_loan ON overdue_records(loan_id);
CREATE INDEX IF NOT EXISTS idx_overdue_records_customer ON overdue_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_overdue_records_status ON overdue_records(status);
CREATE INDEX IF NOT EXISTS idx_negotiation_records_loan ON negotiation_records(loan_id);
CREATE INDEX IF NOT EXISTS idx_negotiation_records_status ON negotiation_records(status);
CREATE INDEX IF NOT EXISTS idx_collection_records_loan ON collection_records(loan_id);
CREATE INDEX IF NOT EXISTS idx_collection_records_customer ON collection_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_risk_tags_customer ON customer_risk_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_risk_tags_tag ON customer_risk_tags(tag_id);

-- 创建逾期计算函数
CREATE OR REPLACE FUNCTION calculate_overdue_days(loan_id_param INTEGER)
RETURNS INTEGER AS $$
DECLARE
    loan_record RECORD;
    last_payment_date DATE;
    current_date DATE := CURRENT_DATE;
    overdue_days INTEGER := 0;
BEGIN
    -- 获取贷款信息
    SELECT * INTO loan_record FROM loans WHERE id = loan_id_param;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- 获取最后还款日期
    SELECT MAX(payment_date) INTO last_payment_date 
    FROM repayments 
    WHERE loan_id = loan_id_param AND status = 'paid';
    
    -- 如果没有还款记录，使用放款日期
    IF last_payment_date IS NULL THEN
        last_payment_date := loan_record.disbursement_date;
    END IF;
    
    -- 计算逾期天数
    IF last_payment_date < current_date THEN
        overdue_days := current_date - last_payment_date;
    END IF;
    
    RETURN overdue_days;
END;
$$ LANGUAGE plpgsql;

-- 创建更新逾期状态的函数
CREATE OR REPLACE FUNCTION update_overdue_status()
RETURNS TRIGGER AS $$
DECLARE
    overdue_days INTEGER;
    config_record RECORD;
    new_status VARCHAR(20);
    new_risk_level VARCHAR(20);
BEGIN
    -- 获取逾期配置
    SELECT * INTO config_record FROM overdue_config WHERE is_active = true LIMIT 1;
    
    -- 计算逾期天数
    overdue_days := calculate_overdue_days(NEW.id);
    
    -- 更新逾期天数
    NEW.overdue_days := overdue_days;
    
    -- 确定状态和风险等级
    IF overdue_days = 0 THEN
        new_status := 'active';
        new_risk_level := 'low';
    ELSIF overdue_days <= config_record.grace_period_days THEN
        new_status := 'active';
        new_risk_level := 'low';
    ELSIF overdue_days <= config_record.negotiation_threshold_days THEN
        new_status := 'overdue';
        new_risk_level := 'medium';
    ELSIF overdue_days <= config_record.bad_debt_threshold_days THEN
        new_status := 'negotiating';
        new_risk_level := 'high';
    ELSE
        new_status := 'bad_debt';
        new_risk_level := 'critical';
    END IF;
    
    -- 更新状态和风险等级
    NEW.status := new_status;
    NEW.risk_level := new_risk_level;
    
    -- 更新客户状态
    UPDATE customers 
    SET status = new_status,
        overdue_count = (
            SELECT COUNT(*) FROM loans 
            WHERE customer_id = NEW.customer_id AND overdue_days > 0
        ),
        max_overdue_days = GREATEST(
            max_overdue_days, 
            overdue_days
        )
    WHERE id = NEW.customer_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
CREATE TRIGGER trigger_update_overdue_status
    BEFORE INSERT OR UPDATE ON loans
    FOR EACH ROW
    EXECUTE FUNCTION update_overdue_status();

-- 创建月度快照生成函数
CREATE OR REPLACE FUNCTION generate_monthly_snapshot(snapshot_date_param DATE)
RETURNS VOID AS $$
DECLARE
    snapshot_data RECORD;
BEGIN
    -- 计算月度快照数据
    SELECT 
        COUNT(*) as total_loans,
        COALESCE(SUM(principal_amount), 0) as total_principal,
        COALESCE(SUM(received_amount), 0) as total_received,
        COALESCE(SUM(deposit_amount), 0) as total_deposits,
        COALESCE(SUM(prepaid_amount), 0) as total_prepaid,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_loans,
        COUNT(CASE WHEN overdue_days > 0 THEN 1 END) as overdue_loans,
        COUNT(CASE WHEN status = 'bad_debt' THEN 1 END) as bad_debt_loans
    INTO snapshot_data
    FROM loans
    WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', snapshot_date_param);
    
    -- 插入快照记录
    INSERT INTO monthly_snapshots (
        snapshot_date, total_loans, total_principal, total_received,
        total_deposits, total_prepaid, active_loans, overdue_loans, bad_debt_loans
    ) VALUES (
        snapshot_date_param, snapshot_data.total_loans, snapshot_data.total_principal,
        snapshot_data.total_received, snapshot_data.total_deposits, snapshot_data.total_prepaid,
        snapshot_data.active_loans, snapshot_data.overdue_loans, snapshot_data.bad_debt_loans
    ) ON CONFLICT (snapshot_date) DO UPDATE SET
        total_loans = EXCLUDED.total_loans,
        total_principal = EXCLUDED.total_principal,
        total_received = EXCLUDED.total_received,
        total_deposits = EXCLUDED.total_deposits,
        total_prepaid = EXCLUDED.total_prepaid,
        active_loans = EXCLUDED.active_loans,
        overdue_loans = EXCLUDED.overdue_loans,
        bad_debt_loans = EXCLUDED.bad_debt_loans;
END;
$$ LANGUAGE plpgsql;
