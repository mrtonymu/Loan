# 贷款管理系统 (Loan Management System)

一个现代化的贷款管理系统，基于 React + Node.js + Supabase 构建。

## 🚀 功能特性

### 核心功能

- **客户管理** - 客户信息管理、状态跟踪、自动编号生成
- **贷款管理** - 贷款发放、还款管理、利息计算
- **还款系统** - 灵活的还款方式、自动计算下一期
- **逾期管理** - 逾期客户跟踪、风险评估、催收建议
- **报表系统** - 财务报表、客户分析、员工绩效
- **权限管理** - 基于角色的访问控制

### 业务特色

- **灵活贷款模式** - 支持两种贷款计算模式
  - 模式1：有抵押 + 固定本金比例还款
  - 模式2：等额分期还款（可选抵押）
- **实时计算** - 前端实时显示贷款计算结果
- **客户状态管理** - 正常/清完/谈帐/烂账状态跟踪
- **现代化UI** - 基于 Ant Design 的现代化界面设计

## 🛠 技术栈

### 前端

- **React 18** - 用户界面框架
- **TypeScript** - 类型安全
- **Ant Design** - UI 组件库
- **Recharts** - 数据可视化
- **React Router** - 路由管理

### 后端

- **Node.js** - 服务器运行环境
- **Express** - Web 框架
- **Supabase** - 数据库和认证服务
- **JWT** - 身份验证

### 数据库

- **PostgreSQL** - 主数据库（通过 Supabase）

## 📦 安装和运行

### 环境要求

- Node.js 16+
- npm 或 yarn

### 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client
npm install
```

### 环境配置

创建 `.env` 文件并配置以下变量：

```env
# 数据库配置
DB_HOST=your-supabase-host
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-password

# Supabase 配置
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# JWT 密钥
JWT_SECRET=your-jwt-secret

# 服务器配置
PORT=3001
NODE_ENV=development
```

### 启动应用

```bash
# 启动后端服务器
npm start

# 启动前端开发服务器
cd client
npm start
```

访问 `http://localhost:3000` 查看应用。

## 🗄 数据库结构

### 主要表结构

- `users` - 用户表
- `customers` - 客户表
- `loans` - 贷款表
- `repayments` - 还款表
- `overdue_config` - 逾期配置表
- `monthly_snapshots` - 月度快照表
- `audit_logs` - 审计日志表

## 🔐 权限系统

### 角色定义

- **admin** - 管理员：所有权限
- **manager** - 经理：管理权限
- **secretary** - 秘书：编辑权限
- **employee** - 员工：查看权限

### 权限控制

- 基于角色的访问控制 (RBAC)
- 页面级权限控制
- API 接口权限验证

## 📊 业务逻辑

### 贷款计算模式

#### 模式1：有抵押 + 固定本金比例还款

```text
利息 = 借款金额 × 利息比例
到手金额 = 借款金额 - 利息 - 抵押
每期还款 = (借款金额 × 本金比例) + 利息
期数 = 1 ÷ 本金比例
总还款 = (每期还款 × 期数) - 抵押
公司利润 = 总还款 - 借款金额
```

#### 模式2：等额分期还款

```text
利息 = 借款金额 × 利息比例
到手金额 = 借款金额 - 利息 - 抵押
每期还款 = (借款金额 + 利息) ÷ 期数
总还款 = 每期还款 × 期数 - 抵押
公司利润 = 总还款 - 借款金额
```

## 🎨 UI/UX 特色

- **现代化设计** - 渐变背景、圆角设计、阴影效果
- **响应式布局** - 支持桌面端和移动端
- **交互体验** - 悬停效果、动画过渡
- **数据可视化** - 丰富的图表和统计展示

## 📱 页面结构

- **登录页面** - 用户认证
- **仪表板** - 数据概览和统计
- **客户管理** - 客户信息管理
- **贷款管理** - 贷款申请和处理
- **还款管理** - 还款记录和跟踪
- **逾期管理** - 逾期客户处理
- **报表中心** - 各类业务报表

## 🔧 开发说明

### 项目结构

```text
├── client/                 # 前端 React 应用
│   ├── src/
│   │   ├── components/     # 可复用组件
│   │   ├── pages/         # 页面组件
│   │   ├── services/      # API 服务
│   │   ├── styles/        # 样式文件
│   │   └── utils/         # 工具函数
├── server/                # 后端 Node.js 应用
│   ├── routes/           # API 路由
│   ├── middleware/       # 中间件
│   ├── utils/           # 工具函数
│   └── sql/             # SQL 脚本
└── README.md
```

### 代码规范

- 使用 TypeScript 进行类型检查
- 遵循 ESLint 代码规范
- 组件化开发，提高代码复用性
- 统一的错误处理和用户反馈

## 📄 许可证

MIT License

## 👥 贡献

欢迎提交 Issue 和 Pull Request 来改进项目。

## 📞 联系方式

- GitHub: [@mrtonymu](https://github.com/mrtonymu)
- Email: [timiemarketing@gmail.com](mailto:timiemarketing@gmail.com)
