// 贷款计算工具类

/**
 * 计算贷款相关金额 - 根据实际业务需求实现
 * @param {Object} params - 计算参数
 * @param {number} params.principalAmount - 借款金额
 * @param {number} params.interestRate - 利息比例（如15% = 0.15）
 * @param {number} params.depositAmount - 抵押金额
 * @param {string} params.loanMethod - 贷款方法 ('method1' 或 'method2')
 * @param {number} params.principalRatePerPeriod - 模式1每期还本金比例（如10% = 0.10）
 * @param {number} params.periods - 模式2分期期数
 * @param {number} params.upfrontFees - 前置费用
 * @returns {Object} 计算结果
 */
function calculateLoanAmounts(params) {
  const {
    principalAmount,
    interestRate, // 利息比例，如15% = 0.15
    depositAmount = 0,
    loanMethod = 'method1',
    principalRatePerPeriod = 0.10, // 模式1每期还本金比例，如10% = 0.10
    periods = 4, // 模式2分期期数
    upfrontFees = 0
  } = params;

  // 计算利息金额
  const interest = principalAmount * interestRate;
  
  // 计算到手金额
  const receivedAmount = principalAmount - interest - depositAmount - upfrontFees;

  let result = {
    principalAmount,
    interestRate,
    interest: Math.round(interest * 100) / 100,
    depositAmount,
    upfrontFees,
    receivedAmount: Math.max(0, Math.round(receivedAmount * 100) / 100),
    loanMethod
  };

  if (loanMethod === 'method1') {
    // 模式1: 有抵押 + 每期还本金固定比例 + 全额利息前置
    const paymentPerPeriod = (principalAmount * principalRatePerPeriod) + interest;
    const numberOfPeriods = Math.ceil(1 / principalRatePerPeriod); // 期数
    const totalRepayment = (paymentPerPeriod * numberOfPeriods) - depositAmount;
    const profit = totalRepayment - principalAmount;
    
    result.paymentPerPeriod = Math.round(paymentPerPeriod * 100) / 100;
    result.numberOfPeriods = numberOfPeriods;
    result.totalRepayment = Math.round(totalRepayment * 100) / 100;
    result.profit = Math.round(profit * 100) / 100;
    result.targetAmount = principalAmount; // 目标总额 = 借款金额
    
  } else if (loanMethod === 'method2') {
    // 模式2: 等额分期还款（可有抵押或无抵押）
    const paymentPerPeriod = (principalAmount + interest) / periods;
    const totalRepayment = (paymentPerPeriod * periods) - depositAmount;
    const profit = totalRepayment - principalAmount;
    
    result.paymentPerPeriod = Math.round(paymentPerPeriod * 100) / 100;
    result.numberOfPeriods = periods;
    result.totalRepayment = Math.round(totalRepayment * 100) / 100;
    result.profit = Math.round(profit * 100) / 100;
    result.targetAmount = principalAmount + interest; // 目标总额 = 借款金额 + 利息
  }

  return result;
}

/**
 * 生成还款计划 - 根据实际业务需求实现
 * @param {Object} loanData - 贷款数据
 * @returns {Array} 还款计划数组
 */
function generateRepaymentSchedule(loanData) {
  const {
    principalAmount,
    interestRate,
    depositAmount = 0,
    loanMethod,
    principalRatePerPeriod = 0.10,
    periods = 4,
    paymentPerPeriod,
    numberOfPeriods
  } = loanData;

  const repayments = [];
  
  if (loanMethod === 'method1') {
    // 模式1: 每期还本金固定比例 + 全额利息前置
    const principalPerPeriod = principalAmount * principalRatePerPeriod;
    const interest = principalAmount * interestRate;
    
    for (let i = 1; i <= numberOfPeriods; i++) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (i * 8)); // 每8天一期
      
      const remainingPrincipal = Math.max(0, principalAmount - (principalPerPeriod * (i - 1)));
      const currentPrincipalPayment = Math.min(principalPerPeriod, remainingPrincipal);
      
      repayments.push({
        repayment_number: i,
        due_date: dueDate.toISOString().split('T')[0],
        principal_amount: Math.round(currentPrincipalPayment * 100) / 100,
        interest_amount: i === 1 ? Math.round(interest * 100) / 100 : 0, // 第一期包含全额利息
        total_amount: Math.round((currentPrincipalPayment + (i === 1 ? interest : 0)) * 100) / 100,
        remaining_balance: Math.max(0, remainingPrincipal - currentPrincipalPayment)
      });
    }
    
    // 最后一期退还抵押金
    if (depositAmount > 0) {
      const lastDueDate = new Date();
      lastDueDate.setDate(lastDueDate.getDate() + (numberOfPeriods * 8));
      
      repayments.push({
        repayment_number: numberOfPeriods + 1,
        due_date: lastDueDate.toISOString().split('T')[0],
        principal_amount: 0,
        interest_amount: 0,
        total_amount: -Math.round(depositAmount * 100) / 100, // 负数表示退还
        remaining_balance: 0,
        note: '退还抵押金'
      });
    }
    
  } else if (loanMethod === 'method2') {
    // 模式2: 等额分期还款
    for (let i = 1; i <= periods; i++) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (i * 8)); // 每8天一期
      
      repayments.push({
        repayment_number: i,
        due_date: dueDate.toISOString().split('T')[0],
        principal_amount: Math.round((principalAmount / periods) * 100) / 100,
        interest_amount: Math.round(((principalAmount * interestRate) / periods) * 100) / 100,
        total_amount: Math.round(paymentPerPeriod * 100) / 100,
        remaining_balance: Math.max(0, (principalAmount + (principalAmount * interestRate)) - (paymentPerPeriod * i))
      });
    }
    
    // 如果有抵押金，最后一期退还
    if (depositAmount > 0) {
      const lastDueDate = new Date();
      lastDueDate.setDate(lastDueDate.getDate() + (periods * 8));
      
      repayments.push({
        repayment_number: periods + 1,
        due_date: lastDueDate.toISOString().split('T')[0],
        principal_amount: 0,
        interest_amount: 0,
        total_amount: -Math.round(depositAmount * 100) / 100, // 负数表示退还
        remaining_balance: 0,
        note: '退还抵押金'
      });
    }
  }

  return repayments;
}

/**
 * 处理还款分配
 * @param {Object} params - 分配参数
 * @param {number} params.paidAmount - 实付金额
 * @param {number} params.outstandingFees - 未付费用
 * @param {number} params.outstandingInterest - 未付利息
 * @param {number} params.outstandingPrincipal - 未付本金
 * @param {number} params.prepaidAmount - 预收金额
 * @returns {Object} 分配结果
 */
function allocatePayment(params) {
  const {
    paidAmount,
    outstandingFees = 0,
    outstandingInterest = 0,
    outstandingPrincipal = 0,
    prepaidAmount = 0
  } = params;

  let remainingPaid = paidAmount;
  const allocation = {
    feeAmount: 0,
    interestAmount: 0,
    principalAmount: 0,
    prepaidOffset: 0,
    newPrepaidAmount: prepaidAmount
  };

  // 1. 先还费用
  if (remainingPaid > 0 && outstandingFees > 0) {
    allocation.feeAmount = Math.min(remainingPaid, outstandingFees);
    remainingPaid -= allocation.feeAmount;
  }

  // 2. 再还利息
  if (remainingPaid > 0 && outstandingInterest > 0) {
    allocation.interestAmount = Math.min(remainingPaid, outstandingInterest);
    remainingPaid -= allocation.interestAmount;
  }

  // 3. 最后还本金
  if (remainingPaid > 0 && outstandingPrincipal > 0) {
    allocation.principalAmount = Math.min(remainingPaid, outstandingPrincipal);
    remainingPaid -= allocation.principalAmount;
  }

  // 4. 剩余金额记入预收
  if (remainingPaid > 0) {
    allocation.prepaidOffset = remainingPaid;
    allocation.newPrepaidAmount = prepaidAmount + remainingPaid;
  }

  return allocation;
}

/**
 * 检查结清条件
 * @param {Object} loanData - 贷款数据
 * @returns {boolean} 是否结清
 */
function checkSettlementCondition(loanData) {
  const {
    outstandingInterest = 0,
    outstandingPrincipal = 0
  } = loanData;

  // 当应收利息 = 0 且 应收本金 = 0 时，贷款结清
  return outstandingInterest === 0 && outstandingPrincipal === 0;
}

/**
 * 计算逾期天数
 * @param {Object} params - 计算参数
 * @param {string} params.dueDate - 到期日期
 * @param {number} params.paidAmount - 已付金额
 * @param {number} params.requiredAmount - 应还金额
 * @param {number} params.gracePeriodDays - 宽限天数
 * @returns {number} 逾期天数
 */
function calculateOverdueDays(params) {
  const {
    dueDate,
    paidAmount,
    requiredAmount,
    gracePeriodDays = 0
  } = params;

  const today = new Date();
  const due = new Date(dueDate);
  const graceDate = new Date(due);
  graceDate.setDate(graceDate.getDate() + gracePeriodDays);

  // 如果已付金额 >= 应还金额，不算逾期
  if (paidAmount >= requiredAmount) {
    return 0;
  }

  // 计算逾期天数
  const overdueDays = Math.max(0, Math.floor((today - graceDate) / (1000 * 60 * 60 * 24)));
  return overdueDays;
}

/**
 * 更新客户状态
 * @param {Object} params - 参数
 * @param {number} params.overdueDays - 逾期天数
 * @param {number} params.negotiationThreshold - 协商阈值
 * @param {number} params.badDebtThreshold - 坏账阈值
 * @returns {string} 客户状态
 */
function updateCustomerStatus(params) {
  const {
    overdueDays,
    negotiationThreshold = 30,
    badDebtThreshold = 90
  } = params;

  if (overdueDays === 0) {
    return 'normal';
  } else if (overdueDays <= negotiationThreshold) {
    return 'negotiating';
  } else {
    return 'bad_debt';
  }
}

/**
 * 计算逾期费用
 * @param {Object} params - 参数
 * @param {number} params.overdueDays - 逾期天数
 * @param {number} params.overdueAmount - 逾期金额
 * @param {number} params.dailyPenaltyRate - 日罚息率（百分比）
 * @param {number} params.fixedPenalty - 固定罚金
 * @returns {number} 逾期费用
 */
function calculateOverdueFees(params) {
  const {
    overdueDays,
    overdueAmount,
    dailyPenaltyRate = 0.1, // 0.1% 日罚息
    fixedPenalty = 50 // 固定罚金50元
  } = params;

  if (overdueDays <= 0) {
    return 0;
  }

  const dailyPenalty = (overdueAmount * dailyPenaltyRate / 100) * overdueDays;
  const totalFees = dailyPenalty + fixedPenalty;
  
  return parseFloat(totalFees.toFixed(2));
}

/**
 * 计算风险等级
 * @param {Object} params - 参数
 * @param {number} params.overdueDays - 逾期天数
 * @param {number} params.overdueCount - 历史逾期次数
 * @param {number} params.loanAmount - 贷款金额
 * @param {boolean} params.isBlacklisted - 是否在黑名单
 * @returns {string} 风险等级
 */
function calculateRiskLevel(params) {
  const {
    overdueDays,
    overdueCount = 0,
    loanAmount,
    isBlacklisted = false
  } = params;

  // 黑名单客户直接标记为critical
  if (isBlacklisted) {
    return 'critical';
  }

  // 根据逾期天数和历史记录计算风险等级
  if (overdueDays >= 90 || overdueCount >= 5) {
    return 'critical';
  } else if (overdueDays >= 30 || overdueCount >= 3) {
    return 'high';
  } else if (overdueDays >= 7 || overdueCount >= 1) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * 生成催收建议
 * @param {Object} params - 参数
 * @param {number} params.overdueDays - 逾期天数
 * @param {string} params.riskLevel - 风险等级
 * @param {number} params.overdueAmount - 逾期金额
 * @returns {Object} 催收建议
 */
function generateCollectionAdvice(params) {
  const {
    overdueDays,
    riskLevel,
    overdueAmount
  } = params;

  let advice = {
    priority: 'low',
    methods: [],
    nextAction: '',
    timeline: ''
  };

  if (overdueDays <= 7) {
    advice.priority = 'low';
    advice.methods = ['电话催收', '短信提醒'];
    advice.nextAction = '温和提醒客户还款';
    advice.timeline = '1-3天内';
  } else if (overdueDays <= 30) {
    advice.priority = 'medium';
    advice.methods = ['电话催收', '短信催收', '邮件催收'];
    advice.nextAction = '加强催收力度，了解客户情况';
    advice.timeline = '3-7天内';
  } else if (overdueDays <= 60) {
    advice.priority = 'high';
    advice.methods = ['上门催收', '律师函', '协商还款'];
    advice.nextAction = '考虑协商还款或法律手段';
    advice.timeline = '立即处理';
  } else {
    advice.priority = 'critical';
    advice.methods = ['法律诉讼', '征信上报', '资产查封'];
    advice.nextAction = '启动法律程序';
    advice.timeline = '立即处理';
  }

  // 根据风险等级调整建议
  if (riskLevel === 'critical') {
    advice.priority = 'critical';
    advice.methods.unshift('紧急催收');
  }

  return advice;
}

/**
 * 计算客户信用评分
 * @param {Object} params - 参数
 * @param {number} params.overdueCount - 逾期次数
 * @param {number} params.maxOverdueDays - 最大逾期天数
 * @param {number} params.totalLoans - 总贷款次数
 * @param {number} params.successfulLoans - 成功还款次数
 * @param {boolean} params.isBlacklisted - 是否在黑名单
 * @returns {number} 信用评分 (0-100)
 */
function calculateCreditScore(params) {
  const {
    overdueCount = 0,
    maxOverdueDays = 0,
    totalLoans = 0,
    successfulLoans = 0,
    isBlacklisted = false
  } = params;

  // 黑名单客户得0分
  if (isBlacklisted) {
    return 0;
  }

  let score = 100;

  // 逾期次数扣分
  score -= overdueCount * 10;

  // 最大逾期天数扣分
  if (maxOverdueDays > 0) {
    score -= Math.min(maxOverdueDays * 0.5, 30);
  }

  // 还款成功率加分
  if (totalLoans > 0) {
    const successRate = successfulLoans / totalLoans;
    score += successRate * 20;
  }

  // 确保分数在0-100之间
  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = {
  calculateLoanAmounts,
  generateRepaymentSchedule,
  allocatePayment,
  checkSettlementCondition,
  calculateOverdueDays,
  updateCustomerStatus,
  calculateOverdueFees,
  calculateRiskLevel,
  generateCollectionAdvice,
  calculateCreditScore
};
