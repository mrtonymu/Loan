const Joi = require('joi');

// 客户验证规则
const customerSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required().messages({
    'string.empty': '姓名不能为空',
    'string.min': '姓名至少2个字符',
    'string.max': '姓名不能超过100个字符'
  }),
  id_number: Joi.string().pattern(/^[0-9X]{18}$/).required().messages({
    'string.pattern.base': '身份证号格式不正确',
    'string.empty': '身份证号不能为空'
  }),
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required().messages({
    'string.pattern.base': '手机号格式不正确',
    'string.empty': '手机号不能为空'
  }),
  address: Joi.string().max(500).allow('').messages({
    'string.max': '地址不能超过500个字符'
  }),
  emergency_contact: Joi.string().max(100).allow('').messages({
    'string.max': '紧急联系人不能超过100个字符'
  }),
  emergency_phone: Joi.string().pattern(/^1[3-9]\d{9}$/).allow('').messages({
    'string.pattern.base': '紧急联系人手机号格式不正确'
  }),
  assigned_to: Joi.number().integer().positive().allow(null),
  notes: Joi.string().max(1000).allow('').messages({
    'string.max': '备注不能超过1000个字符'
  })
});

// 贷款验证规则
const loanSchema = Joi.object({
  customer_id: Joi.number().integer().positive().required().messages({
    'number.base': '客户ID必须是数字',
    'any.required': '客户ID不能为空'
  }),
  principal_amount: Joi.number().positive().precision(2).required().messages({
    'number.positive': '本金必须大于0',
    'any.required': '本金不能为空'
  }),
  interest_rate: Joi.number().min(0).max(100).precision(2).required().messages({
    'number.min': '利率不能小于0',
    'number.max': '利率不能大于100',
    'any.required': '利率不能为空'
  }),
  loan_term_months: Joi.number().integer().min(1).max(360).required().messages({
    'number.integer': '贷款期限必须是整数',
    'number.min': '贷款期限至少1个月',
    'number.max': '贷款期限不能超过360个月',
    'any.required': '贷款期限不能为空'
  }),
  collateral_description: Joi.string().max(500).allow('').messages({
    'string.max': '抵押物描述不能超过500个字符'
  }),
  collateral_value: Joi.number().positive().precision(2).allow(null).messages({
    'number.positive': '抵押物价值必须大于0'
  }),
  loan_purpose: Joi.string().max(500).allow('').messages({
    'string.max': '贷款用途不能超过500个字符'
  })
});

// 还款验证规则
const repaymentSchema = Joi.object({
  loan_id: Joi.number().integer().positive().required().messages({
    'number.base': '贷款ID必须是数字',
    'any.required': '贷款ID不能为空'
  }),
  paid_amount: Joi.number().positive().precision(2).required().messages({
    'number.positive': '还款金额必须大于0',
    'any.required': '还款金额不能为空'
  }),
  payment_method: Joi.string().valid('cash', 'bank_transfer', 'check', 'other').required().messages({
    'any.only': '还款方式必须是：现金、银行转账、支票或其他',
    'any.required': '还款方式不能为空'
  }),
  notes: Joi.string().max(500).allow('').messages({
    'string.max': '备注不能超过500个字符'
  })
});

// 用户验证规则
const userSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required().messages({
    'string.alphanum': '用户名只能包含字母和数字',
    'string.min': '用户名至少3个字符',
    'string.max': '用户名不能超过30个字符',
    'any.required': '用户名不能为空'
  }),
  email: Joi.string().email().required().messages({
    'string.email': '邮箱格式不正确',
    'any.required': '邮箱不能为空'
  }),
  password: Joi.string().min(6).max(128).required().messages({
    'string.min': '密码至少6个字符',
    'string.max': '密码不能超过128个字符',
    'any.required': '密码不能为空'
  }),
  role: Joi.string().valid('employee', 'secretary', 'manager', 'admin').required().messages({
    'any.only': '角色必须是：员工、秘书、经理或管理员',
    'any.required': '角色不能为空'
  }),
  full_name: Joi.string().min(2).max(100).required().messages({
    'string.min': '姓名至少2个字符',
    'string.max': '姓名不能超过100个字符',
    'any.required': '姓名不能为空'
  }),
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).allow('').messages({
    'string.pattern.base': '手机号格式不正确'
  })
});

// 验证中间件
const validateCustomer = (req, res, next) => {
  const { error } = customerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      message: '数据验证失败',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
};

const validateLoan = (req, res, next) => {
  const { error } = loanSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      message: '数据验证失败',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
};

const validateRepayment = (req, res, next) => {
  const { error } = repaymentSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      message: '数据验证失败',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
};

const validateUser = (req, res, next) => {
  const { error } = userSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      message: '数据验证失败',
      errors: error.details.map(detail => detail.message)
    });
  }
  next();
};

module.exports = {
  validateCustomer,
  validateLoan,
  validateRepayment,
  validateUser,
  customerSchema,
  loanSchema,
  repaymentSchema,
  userSchema
};
