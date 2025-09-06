# 货币格式化更新说明

## 🎯 更新目标

将所有货币显示从人民币符号（¥）更改为马币符号（RM），确保系统符合马来西亚本地化要求。

## ✅ 已完成的更新

### 1. 创建货币工具函数

**文件**: `client/src/utils/currency.ts`

提供了三个货币格式化函数：

- `formatCurrency()` - 标准马币格式（带2位小数）
- `formatCurrencyNoDecimals()` - 马币格式（无小数）
- `formatCurrencyCompact()` - 紧凑格式（K/M后缀）

**示例**:

```typescript
formatCurrency(1234.56)        // "RM 1,234.56"
formatCurrencyNoDecimals(1234) // "RM 1,234"
formatCurrencyCompact(1500000) // "RM 1.5M"
```

### 2. 更新客户管理页面

**文件**: `client/src/pages/Customers/CustomerList.tsx`

- ✅ RM金额列：`¥${amount.toLocaleString()}` → `formatCurrency(amount)`
- ✅ 总贷款额列：`¥${(amount || 0).toLocaleString()}` → `formatCurrency(amount || 0)`

### 3. 更新仪表盘页面

**文件**: `client/src/pages/Dashboard/Dashboard.tsx`

- ✅ 逾期金额列：`¥${amount.toLocaleString()}` → `formatCurrency(amount)`
- ✅ 最近活动金额列：`¥${amount.toLocaleString()}` → `formatCurrency(amount)`
- ✅ 统计卡片使用紧凑格式：
  - 总放款额：`formatCurrencyCompact(stats?.total_principal || 0, false)`
  - 总回款额：`formatCurrencyCompact(stats?.total_paid || 0, false)`
  - 逾期金额：`formatCurrencyCompact(stats?.overdue_amount || 0, false)`

### 4. 更新文档

- ✅ `DEMO.md` - 更新功能描述中的货币说明
- ✅ 所有金额相关描述都标注为"马币RM"

## 🔧 技术实现

### 货币格式化规则

- **货币符号**: RM（马来西亚林吉特）
- **千位分隔符**: 逗号（,）
- **小数位数**: 2位（标准格式）
- **本地化**: 使用马来西亚英语格式（en-MY）

### 格式化示例

```typescript
// 标准格式
formatCurrency(1234567.89)  // "RM 1,234,567.89"

// 无小数格式
formatCurrencyNoDecimals(1234567)  // "RM 1,234,567"

// 紧凑格式
formatCurrencyCompact(1234567)     // "RM 1.2M"
formatCurrencyCompact(123456)      // "RM 123.5K"
formatCurrencyCompact(1234)        // "RM 1,234.00"
```

## 📱 用户界面更新

### 客户列表页面

- **RM金额列**: 显示为 "RM 50,000.00" 格式
- **总贷款额列**: 显示为 "RM 25,000.00" 格式

### 仪表盘页面

- **统计卡片**: 大金额使用紧凑格式（如 "RM 1.5M"）
- **表格数据**: 使用标准格式（如 "RM 1,234.56"）
- **逾期金额**: 清晰显示马币金额

## 🎨 视觉效果

### 更新前

```text
¥50,000.00
¥1,234,567.89
```

### 更新后

```text
RM 50,000.00
RM 1.2M
```

## 🔍 验证方法

1. **登录系统**: [http://localhost:3000](http://localhost:3000)
2. **查看客户列表**: 确认RM金额列显示马币格式
3. **查看仪表盘**: 确认所有金额都显示为RM格式
4. **检查统计卡片**: 确认大金额使用紧凑格式

## 📋 检查清单

- [x] 创建货币工具函数
- [x] 更新客户列表页面
- [x] 更新仪表盘页面
- [x] 更新文档说明
- [x] 测试系统功能
- [x] 验证货币显示格式

## 🚀 后续计划

当添加新的页面时，请确保：

1. 导入货币工具函数：`import { formatCurrency } from '../../utils/currency'`
2. 使用标准格式：`formatCurrency(amount)`
3. 大金额使用紧凑格式：`formatCurrencyCompact(amount, false)`

## 💡 注意事项

- 所有金额输入和显示都使用马币（RM）
- 数据库中的金额字段保持数值类型，只在显示时格式化
- 货币工具函数支持字符串和数字类型输入
- 格式化函数会自动处理无效输入（NaN、null、undefined）

---

**更新完成时间**: 2025年9月5日  
**影响范围**: 前端显示层  
**向后兼容**: 是（数据库结构无变化）
