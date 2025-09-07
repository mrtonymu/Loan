#!/bin/bash

# 贷款管理系统启动脚本

echo "🚀 启动贷款管理系统..."

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 16+"
    exit 1
fi

# 检查PostgreSQL是否安装
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL 未安装，请先安装 PostgreSQL 12+"
    exit 1
fi

# 检查环境变量文件
if [ ! -f .env ]; then
    echo "📝 创建环境变量文件..."
    cp env.example .env
    echo "⚠️  请编辑 .env 文件配置数据库连接信息"
fi

# 安装依赖
echo "📦 安装后端依赖..."
npm install

echo "📦 安装前端依赖..."
cd client
npm install
cd ..

# 检查数据库连接
echo "🔍 检查数据库连接..."
if ! psql -h localhost -U postgres -d loan_management -c "SELECT 1;" &> /dev/null; then
    echo "⚠️  数据库连接失败，请检查 .env 文件中的数据库配置"
    echo "💡 提示：确保PostgreSQL服务正在运行，并且数据库 'loan_management' 已创建"
    echo "💡 可以运行以下命令创建数据库："
    echo "   createdb loan_management"
    echo "   psql -d loan_management -f server/sql/schema.sql"
    echo "   psql -d loan_management -f server/sql/init.sql"
fi

# 启动应用
echo "🎯 启动应用..."
echo "📱 前端地址: http://localhost:3000"
echo "🔧 后端API: http://localhost:5000"
echo "👤 默认账户: admin / password"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

# 同时启动前后端
npm run dev
