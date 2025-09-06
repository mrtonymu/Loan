const pool = require('../config/database');

// 权限定义
const PERMISSIONS = {
  // 仪表盘权限
  DASHBOARD_VIEW: 'dashboard:view',
  
  // 客户管理权限
  CUSTOMER_VIEW: 'customer:view',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_EDIT: 'customer:edit',
  CUSTOMER_DELETE: 'customer:delete',
  
  // 贷款管理权限
  LOAN_VIEW: 'loan:view',
  LOAN_CREATE: 'loan:create',
  LOAN_EDIT: 'loan:edit',
  LOAN_DELETE: 'loan:delete',
  LOAN_APPROVE: 'loan:approve',
  
  // 还款管理权限
  REPAYMENT_VIEW: 'repayment:view',
  REPAYMENT_PROCESS: 'repayment:process',
  REPAYMENT_SETTLE: 'repayment:settle',
  
  // 逾期管理权限
  OVERDUE_VIEW: 'overdue:view',
  OVERDUE_MANAGE: 'overdue:manage',
  OVERDUE_COLLECTION: 'overdue:collection',
  
  // 报表权限
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',
  REPORT_FINANCIAL: 'report:financial',
  REPORT_EMPLOYEE: 'report:employee',
  
  // 系统管理权限
  USER_MANAGE: 'user:manage',
  SYSTEM_CONFIG: 'system:config',
  AUDIT_LOG: 'audit:log'
};

// 定义基础权限
const EMPLOYEE_PERMISSIONS = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.CUSTOMER_CREATE,
  PERMISSIONS.CUSTOMER_EDIT,
  PERMISSIONS.LOAN_VIEW,
  PERMISSIONS.LOAN_CREATE,
  PERMISSIONS.REPAYMENT_VIEW,
  PERMISSIONS.REPAYMENT_PROCESS,
  PERMISSIONS.OVERDUE_VIEW,
  PERMISSIONS.REPORT_VIEW
];

const SECRETARY_ADDITIONAL_PERMISSIONS = [
  PERMISSIONS.LOAN_APPROVE,
  PERMISSIONS.REPAYMENT_SETTLE,
  PERMISSIONS.OVERDUE_MANAGE,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.REPORT_FINANCIAL
];

const MANAGER_ADDITIONAL_PERMISSIONS = [
  PERMISSIONS.CUSTOMER_DELETE,
  PERMISSIONS.LOAN_EDIT,
  PERMISSIONS.LOAN_DELETE,
  PERMISSIONS.OVERDUE_COLLECTION,
  PERMISSIONS.REPORT_EMPLOYEE,
  PERMISSIONS.AUDIT_LOG
];

// 角色权限映射
const ROLE_PERMISSIONS = {
  employee: EMPLOYEE_PERMISSIONS,
  secretary: [...EMPLOYEE_PERMISSIONS, ...SECRETARY_ADDITIONAL_PERMISSIONS],
  manager: [...EMPLOYEE_PERMISSIONS, ...SECRETARY_ADDITIONAL_PERMISSIONS, ...MANAGER_ADDITIONAL_PERMISSIONS],
  admin: Object.values(PERMISSIONS) // 管理员拥有所有权限
};

// 检查用户权限
const checkPermission = (userRole, requiredPermission) => {
  const userPermissions = ROLE_PERMISSIONS[userRole] || [];
  return userPermissions.includes(requiredPermission);
};

// 权限检查中间件
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const userRole = req.user.role;
      
      if (!checkPermission(userRole, permission)) {
        return res.status(403).json({ 
          success: false, 
          message: '权限不足',
          required: permission,
          current_role: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ success: false, message: '权限检查失败' });
    }
  };
};

// 检查多个权限（需要全部满足）
const requireAllPermissions = (permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const userRole = req.user.role;
      const userPermissions = ROLE_PERMISSIONS[userRole] || [];
      
      const hasAllPermissions = permissions.every(permission => 
        userPermissions.includes(permission)
      );

      if (!hasAllPermissions) {
        return res.status(403).json({ 
          success: false, 
          message: '权限不足',
          required: permissions,
          current_role: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ success: false, message: '权限检查失败' });
    }
  };
};

// 检查多个权限（满足其中一个即可）
const requireAnyPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const userRole = req.user.role;
      const userPermissions = ROLE_PERMISSIONS[userRole] || [];
      
      const hasAnyPermission = permissions.some(permission => 
        userPermissions.includes(permission)
      );

      if (!hasAnyPermission) {
        return res.status(403).json({ 
          success: false, 
          message: '权限不足',
          required: permissions,
          current_role: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ success: false, message: '权限检查失败' });
    }
  };
};

// 数据访问控制 - 员工只能访问自己的数据
const dataAccessControl = (entityType) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const userRole = req.user.role;
      const userId = req.user.id;

      // 管理员和经理可以访问所有数据
      if (userRole === 'admin' || userRole === 'manager') {
        return next();
      }

      // 员工只能访问自己创建的数据
      if (userRole === 'employee' || userRole === 'secretary') {
        // 在查询中添加创建者过滤条件
        req.dataFilter = { created_by: userId };
      }

      next();
    } catch (error) {
      console.error('Data access control error:', error);
      res.status(500).json({ success: false, message: '数据访问控制失败' });
    }
  };
};

// 审批权限检查
const requireApprovalPermission = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const userRole = req.user.role;
      
      // 只有秘书、经理和管理员可以审批
      if (!['secretary', 'manager', 'admin'].includes(userRole)) {
        return res.status(403).json({ 
          success: false, 
          message: '无审批权限',
          current_role: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Approval permission check error:', error);
      res.status(500).json({ success: false, message: '审批权限检查失败' });
    }
  };
};

// 获取用户权限列表
const getUserPermissions = (userRole) => {
  return ROLE_PERMISSIONS[userRole] || [];
};

// 检查是否为管理员
const isAdmin = (userRole) => {
  return userRole === 'admin';
};

// 检查是否为经理或管理员
const isManagerOrAdmin = (userRole) => {
  return ['manager', 'admin'].includes(userRole);
};

// 检查是否为秘书、经理或管理员
const isSecretaryOrAbove = (userRole) => {
  return ['secretary', 'manager', 'admin'].includes(userRole);
};

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  checkPermission,
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  dataAccessControl,
  requireApprovalPermission,
  getUserPermissions,
  isAdmin,
  isManagerOrAdmin,
  isSecretaryOrAbove
};
