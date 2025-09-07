-- 添加贷款相关字段到 customers 表
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS loan_method VARCHAR(20),
ADD COLUMN IF NOT EXISTS loan_amount DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS received_amount DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS suggested_payment DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_per_period DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_repayment DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS profit DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS periods INTEGER DEFAULT 0;

-- 添加注释
COMMENT ON COLUMN customers.loan_method IS '贷款模式：method1(有抵押灵活还款) 或 method2(等额分期还款)';
COMMENT ON COLUMN customers.loan_amount IS '借款金额';
COMMENT ON COLUMN customers.interest_rate IS '利息比例(%)';
COMMENT ON COLUMN customers.deposit_amount IS '抵押金额';
COMMENT ON COLUMN customers.received_amount IS '到手金额';
COMMENT ON COLUMN customers.suggested_payment IS '建议每期还款金额';
COMMENT ON COLUMN customers.payment_per_period IS '每期还款金额';
COMMENT ON COLUMN customers.total_repayment IS '总还款金额';
COMMENT ON COLUMN customers.profit IS '公司利润';
COMMENT ON COLUMN customers.periods IS '分期期数';
