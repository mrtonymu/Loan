-- 更新贷款业务逻辑的数据库结构

-- 添加贷款方法类型
ALTER TABLE loans ADD COLUMN IF NOT EXISTS loan_method VARCHAR(20) DEFAULT 'method1' CHECK (loan_method IN ('method1', 'method2'));

-- 添加押金相关字段
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(15,2) DEFAULT 0; -- 押金金额
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deposit_status VARCHAR(20) DEFAULT 'held' CHECK (deposit_status IN ('held', 'refunded', 'offset')); -- 押金状态
ALTER TABLE loans ADD COLUMN IF NOT EXISTS deposit_refund_date DATE; -- 押金退还日期

-- 添加预收/溢缴款字段
ALTER TABLE loans ADD COLUMN IF NOT EXISTS prepaid_amount DECIMAL(15,2) DEFAULT 0; -- 预收金额

-- 添加费用相关字段
ALTER TABLE loans ADD COLUMN IF NOT EXISTS upfront_interest DECIMAL(15,2) DEFAULT 0; -- 前置利息（Method 1）
ALTER TABLE loans ADD COLUMN IF NOT EXISTS upfront_fees DECIMAL(15,2) DEFAULT 0; -- 前置费用

-- 更新还款记录表，添加费用字段
ALTER TABLE repayments ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(15,2) DEFAULT 0; -- 费用金额
ALTER TABLE repayments ADD COLUMN IF NOT EXISTS prepaid_offset DECIMAL(15,2) DEFAULT 0; -- 预收抵扣金额

-- 添加逾期配置表
CREATE TABLE IF NOT EXISTS overdue_config (
    id SERIAL PRIMARY KEY,
    config_name VARCHAR(50) UNIQUE NOT NULL,
    grace_period_days INTEGER DEFAULT 0, -- 宽限天数
    negotiation_threshold_days INTEGER DEFAULT 30, -- 进入协商的天数
    bad_debt_threshold_days INTEGER DEFAULT 90, -- 坏账天数
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认逾期配置
INSERT INTO overdue_config (config_name, grace_period_days, negotiation_threshold_days, bad_debt_threshold_days) 
VALUES ('default', 0, 30, 90) ON CONFLICT (config_name) DO NOTHING;

-- 添加月度快照表
CREATE TABLE IF NOT EXISTS monthly_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    total_loans INTEGER NOT NULL,
    total_principal DECIMAL(15,2) NOT NULL,
    total_received DECIMAL(15,2) NOT NULL,
    total_deposits DECIMAL(15,2) NOT NULL,
    total_prepaid DECIMAL(15,2) NOT NULL,
    active_loans INTEGER NOT NULL,
    overdue_loans INTEGER NOT NULL,
    bad_debt_loans INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 添加审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INTEGER NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_loans_method ON loans(loan_method);
CREATE INDEX IF NOT EXISTS idx_loans_deposit_status ON loans(deposit_status);
CREATE INDEX IF NOT EXISTS idx_repayments_fee ON repayments(fee_amount);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_date ON monthly_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 更新触发器
CREATE OR REPLACE FUNCTION update_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
        VALUES (NEW.created_by, 'CREATE', TG_TABLE_NAME, NEW.id, row_to_json(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
        VALUES (NEW.updated_by, 'UPDATE', TG_TABLE_NAME, NEW.id, row_to_json(OLD), row_to_json(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values)
        VALUES (OLD.updated_by, 'DELETE', TG_TABLE_NAME, OLD.id, row_to_json(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- 为关键表添加审计触发器
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON loans FOR EACH ROW EXECUTE FUNCTION update_audit_log();
CREATE TRIGGER audit_customers AFTER INSERT OR UPDATE OR DELETE ON customers FOR EACH ROW EXECUTE FUNCTION update_audit_log();
CREATE TRIGGER audit_repayments AFTER INSERT OR UPDATE OR DELETE ON repayments FOR EACH ROW EXECUTE FUNCTION update_audit_log();
